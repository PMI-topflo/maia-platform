// =====================================================================
// lib/integrations/cinc.ts
// CINC API client for the work-order sync.
//
// Auth: OAuth 2.0 client_credentials → Bearer token, cached at module
// scope until ~60s before expiry. Each fresh serverless container
// fetches its own token; that's fine.
//
// Endpoints used (all under CINC_API_BASE, mgmtId hardcoded to 1 per
// the CINC API docs):
//   POST   /management/1/linkedWorkOrder       — create work order
//   POST   /management/1/workOrderNotes        — append note
//   GET    /management/1/workOrders            — list / lookup (also
//                                                  used to derive AssocId)
//   GET    /management/1/workOrderTypes        — type catalog (cached)
//   GET    /management/1/workOrderStatuses     — status catalog (cached)
//
// Phase A: outbound only — staff create work-order tickets in our
// system → we mirror them into CINC. Polling for vendor-initiated CINC
// work orders is Phase B.
// =====================================================================

const CLIENT_ID     = process.env.CINC_CLIENT_ID
const CLIENT_SECRET = process.env.CINC_CLIENT_SECRET
const AUTH_URL      = process.env.CINC_AUTH_URL  ?? 'https://identityserver.cincsys.io/connect/token'
const API_BASE      = (process.env.CINC_API_BASE ?? 'https://PMITFP.cincsys.com/api').replace(/\/$/, '')
const SCOPE         = process.env.CINC_SCOPE     ?? 'cincapi.all'

export class CincConfigError extends Error {}
export class CincApiError    extends Error {
  constructor(message: string, public readonly status?: number, public readonly body?: string) {
    super(message)
  }
}

function requireConfig(): { id: string; secret: string } {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new CincConfigError('CINC_CLIENT_ID / CINC_CLIENT_SECRET not set')
  }
  return { id: CLIENT_ID, secret: CLIENT_SECRET }
}

// ─────────────────────────────────────────────────────────────────────
// Token cache (module-scope; valid for one container lifetime)
// ─────────────────────────────────────────────────────────────────────
interface CachedToken { token: string; expiresAt: number }
let _token: CachedToken | null = null

async function getToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.token
  const { id, secret } = requireConfig()

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     id,
    client_secret: secret,
    scope:         SCOPE,
  })

  const res = await fetch(AUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (!res.ok) {
    throw new CincApiError(
      `Token request failed (${res.status})`,
      res.status,
      await res.text(),
    )
  }
  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new CincApiError('No access_token in token response')

  _token = {
    token:     data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) * 1000),
  }
  return _token.token
}

// ─────────────────────────────────────────────────────────────────────
// Generic API caller with automatic token refresh on 401
// ─────────────────────────────────────────────────────────────────────
async function call<T>(
  path:   string,
  init?:  RequestInit & { json?: unknown; query?: Record<string, string | number | undefined | null> },
): Promise<T> {
  const url  = new URL(`${API_BASE}${path}`)
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }

  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${await getToken()}`)
  headers.set('Accept', 'application/json')
  if (init?.json !== undefined) headers.set('Content-Type', 'application/json')

  const res = await fetch(url, {
    ...init,
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  })

  // Token expired mid-flight: bust cache and retry once.
  if (res.status === 401) {
    _token = null
    headers.set('Authorization', `Bearer ${await getToken()}`)
    const retry = await fetch(url, { ...init, headers, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body })
    if (!retry.ok) {
      const body = await retry.text()
      throw new CincApiError(`${init?.method ?? 'GET'} ${path} failed (${retry.status}): ${body.slice(0, 400)}`, retry.status, body)
    }
    return retry.status === 204 ? (undefined as unknown as T) : (await retry.json() as T)
  }

  if (!res.ok) {
    const body = await res.text()
    throw new CincApiError(`${init?.method ?? 'GET'} ${path} failed (${res.status}): ${body.slice(0, 400)}`, res.status, body)
  }
  return res.status === 204 ? (undefined as unknown as T) : (await res.json() as T)
}

// ─────────────────────────────────────────────────────────────────────
// Lookups (cached per container)
// ─────────────────────────────────────────────────────────────────────
interface WorkOrderType   { WorkOrderTypeId: number; WorkOrderTypeDescription: string }
interface WorkOrderStatus { WorkOrderStatusId: number; WorkOrderStatusDescription: string; IsCompleted: number }

let _typesCache:    WorkOrderType[]   | null = null
let _statusesCache: WorkOrderStatus[] | null = null

export async function listWorkOrderTypes(): Promise<WorkOrderType[]> {
  if (_typesCache) return _typesCache
  _typesCache = await call<WorkOrderType[]>('/management/1/workOrderTypes')
  return _typesCache
}

export type WorkOrderTypeSummary = { id: number; name: string }

async function listWorkOrderStatuses(): Promise<WorkOrderStatus[]> {
  if (_statusesCache) return _statusesCache
  _statusesCache = await call<WorkOrderStatus[]>('/management/1/workOrderStatuses')
  return _statusesCache
}

/** Resolve a default work-order type ID. Tries CINC_DEFAULT_WO_TYPE
 *  (configurable in env), falls back to "General Maintenance" or the
 *  first available type. */
export async function getDefaultWorkOrderTypeId(): Promise<number> {
  const types = await listWorkOrderTypes()
  if (types.length === 0) throw new CincApiError('CINC returned no work order types')

  const wanted = (process.env.CINC_DEFAULT_WO_TYPE ?? 'General Maintenance').toLowerCase()
  const hit    = types.find(t => t.WorkOrderTypeDescription?.toLowerCase().includes(wanted))
  return (hit ?? types[0]).WorkOrderTypeId
}

/** Resolve the "Open" work-order status ID, falling back to the first
 *  status if no obvious match. */
export async function getOpenWorkOrderStatusId(): Promise<number> {
  const statuses = await listWorkOrderStatuses()
  if (statuses.length === 0) throw new CincApiError('CINC returned no work order statuses')
  const hit = statuses.find(s => /open|new|pending/i.test(s.WorkOrderStatusDescription ?? ''))
  return (hit ?? statuses[0]).WorkOrderStatusId
}

// ─────────────────────────────────────────────────────────────────────
// Association ID lookup
//
// CINC's create-work-order body wants a numeric `assocId`, but we only
// have our string `association_code`. Until we wire a dedicated
// /associations endpoint or store CINC's id on our `associations`
// table, the workaround here is: query GET /workOrders?assocCode=<code>
// and grab `AssocId` off the first matching row. Cached per container.
//
// Edge case: if there are NO existing CINC work orders for this
// association, we can't derive the id this way. Caller falls back to
// throwing → outbox row marks as failed → staff investigates.
// ─────────────────────────────────────────────────────────────────────
const _assocIdCache = new Map<string, number>()

export interface CincNote {
  NoteId:                       number
  NoteDescription:              string
  NoteCreatedDate:              string
  NoteCreatedUserId?:           number
  NoteCreatedBy?:               string
  IsNotePublic?:                number
  IsNoteEmailedToVendor?:       number
  IsNoteEmailedToWorkLocation?: number
  IsNoteSystemGenerated?:       number
}

export interface CincContact {
  ContactId:     number
  ContactName?:  string
  ContactEmail?: string
  ContactPhone?: string
}

/** A single attachment returned by /management/1/workOrderAttachments.
 *  CINC delivers the binary inline as a base64 string in FileContent;
 *  there is no separate download URL and no attachment ID. We dedupe
 *  on (FileName, CreatedDate, FileSize) when mirroring. */
export interface CincAttachment {
  FileName:    string  // e.g. "file1a42d81c.png" — auto-generated by CINC
  CreatedDate: string  // ISO datetime
  FileSize:    number  // bytes
  FileContent: string  // base64-encoded binary
}

export interface CincWorkOrder {
  WorkOrderId:        number
  AssocId:            number
  AssocCode:          string
  AssociationName?:   string
  HoID?:              string
  PropertyId?:        number
  IsCommonArea?:      number
  IsUnlinked?:        number
  CreatedDate?:       string
  EnteredDate?:       string
  CreatedBy?:         string
  IssuedDate?:        string
  DueDate?:           string
  FollowUpDate?:      string
  Description?:       string
  EstimateTotal?:     number
  WorkOrderStatusId?: number
  WorkOrderStatus?:   string
  WorkOrderTypId?:    number   // sic — CINC's typo in their response
  WorkOrderType?:     string
  Contacts?:          CincContact[]
  VendorId?:          number
  Vendor?:            string
  WorkLocationName?:  string
  AddressLine1?:      string
  AddressLine2?:      string
  City?:              string
  State?:             string
  Zip?:               string
  Notes?:             CincNote[]
}

export async function findAssocIdByCode(assocCode: string): Promise<number | null> {
  const key = assocCode.toUpperCase()
  if (_assocIdCache.has(key)) return _assocIdCache.get(key)!

  const list = await call<CincWorkOrder[]>('/management/1/workOrders', {
    method: 'GET',
    query:  { assocCode: key },
  }).catch(() => [] as CincWorkOrder[])

  const hit = list.find(w => w.AssocCode?.toUpperCase() === key && w.AssocId)
  if (!hit) return null
  _assocIdCache.set(key, hit.AssocId)
  return hit.AssocId
}

// ─────────────────────────────────────────────────────────────────────
// Work-order create (linked to homeowner / association)
// ─────────────────────────────────────────────────────────────────────
export interface CreateWorkOrderInput {
  associationCode:  string                      // our association_code
  description:      string                      // ticket subject + summary
  dueDate?:         string | null               // ISO
  contactEmail?:    string | null
  contactPhone?:    string | null
  contactName?:     string | null
  vendorName?:      string | null
  initialNote?:     string | null
  workOrderTypeId?: number | null               // CINC WorkOrderTypeId; falls back to default if omitted
}

export interface CreateWorkOrderResult {
  workOrderId: number
}

export async function createLinkedWorkOrder(
  input: CreateWorkOrderInput,
): Promise<CreateWorkOrderResult> {
  const [defaultTypeId, statusId, assocId] = await Promise.all([
    getDefaultWorkOrderTypeId(),
    getOpenWorkOrderStatusId(),
    findAssocIdByCode(input.associationCode),
  ])
  // Honor the explicit type ID from the ticket; only fall back to the
  // default when the caller didn't pick one.
  const typeId = input.workOrderTypeId ?? defaultTypeId

  if (!assocId) {
    throw new CincApiError(
      `Cannot resolve CINC AssocId for association_code="${input.associationCode}". ` +
      `Either no work orders exist yet for this association in CINC, or the code differs. ` +
      `Manually create one work order in CINC for this association first, then retry.`,
    )
  }

  const body: Record<string, unknown> = {
    assocId,
    workOrderTypeId:   typeId,
    workOrderStatusId: statusId,
    description:       input.description.slice(0, 1000),
    contactEmail:      input.contactEmail ?? undefined,
    contactPhone:      input.contactPhone ?? undefined,
    vendorName:        input.vendorName   ?? undefined,
    dueDate:           input.dueDate      ?? undefined,
  }
  if (input.initialNote) {
    body.notes = {
      noteDescription:            input.initialNote.slice(0, 4000),
      isNotePublic:               true,
      isNoteEmailedToWorkLocation: false,
      isNoteEmailedToVendor:       false,
    }
  }

  // The /linkedWorkOrder endpoint returns 201 with an empty body in the
  // Swagger example, so we fetch the work order back to learn its id.
  await call<unknown>('/management/1/linkedWorkOrder', { method: 'POST', json: body })

  // Re-query to find the just-created WO. The cleanest unique handle we
  // can use is "newest WO for this association in the last 60s".
  const recent = await call<CincWorkOrder[]>('/management/1/workOrders', {
    method: 'GET',
    query:  { assocId, createdFromDate: new Date(Date.now() - 5 * 60_000).toISOString() },
  }).catch(() => [])
  const newest = recent
    .filter(w => w.WorkOrderId)
    .sort((a, b) => new Date(b.CreatedDate ?? 0).getTime() - new Date(a.CreatedDate ?? 0).getTime())[0]

  if (!newest) {
    throw new CincApiError('Created work order but could not retrieve its WorkOrderId')
  }
  return { workOrderId: newest.WorkOrderId }
}

// ─────────────────────────────────────────────────────────────────────
// Update existing work order — type, description, dates, work location
// (NOT status or vendor; those have their own endpoints).
//
// PATCH /management/1/workOrderDetails uses PascalCase per CINC's spec
// (POST endpoints use camelCase — see docs/cinc-api.md "PascalCase vs
// camelCase inconsistency"). Only WorkOrderId is required; every other
// field is optional and only sent when the caller provides it, so we
// don't accidentally clobber CINC-side values we don't track locally.
// ─────────────────────────────────────────────────────────────────────
export interface UpdateWorkOrderDetailsInput {
  workOrderId:      number
  workOrderTypeId?: number | null
  description?:     string | null
  dueDate?:         string | null
  issuedDate?:      string | null   // → IssuedDate (Scheduled date)
  vendorId?:        number | null   // → VendorId   (reassign vendor)
}

export async function updateWorkOrderDetails(
  input: UpdateWorkOrderDetailsInput,
): Promise<void> {
  // CINC's WorkOrderDetailsUpdateVm:
  //  - Wants a single JSON object (not an array — array gave 400 with
  //    "Cannot deserialize JSON array into WorkOrderDetailsUpdateVm")
  //  - Rejects partial bodies (just {WorkOrderId, WorkOrderTypeId} also
  //    got 400 — CINC requires the full view-model shape)
  //
  // Fix: GET the current work order, project it into the documented
  // PATCH shape, then overlay the caller's changes. This way we only
  // mutate the field(s) the caller actually wanted to change; every
  // other field round-trips unchanged.
  const current = await getWorkOrderById(input.workOrderId)
  if (!current) {
    throw new CincApiError(`Cannot fetch CINC work order ${input.workOrderId} to update`)
  }

  const body: Record<string, unknown> = {
    WorkOrderId:      input.workOrderId,
    WorkOrderTypeId:  input.workOrderTypeId ?? current.WorkOrderTypId ?? null,
    Description:      (input.description    ?? current.Description    ?? '').slice(0, 1000),
    EstimateTotal:    current.EstimateTotal ?? 0,
    IssuedDate:       input.issuedDate      ?? current.IssuedDate     ?? null,
    DueDate:          input.dueDate         ?? current.DueDate        ?? null,
    FollowupDate:     current.FollowUpDate  ?? null,
    PropertyId:       current.PropertyId    ?? null,
    VendorId:         input.vendorId        ?? current.VendorId       ?? null,
    WorkLocationName: current.WorkLocationName ?? '',
    AddressLine1:     current.AddressLine1  ?? '',
    AddressLine2:     current.AddressLine2  ?? '',
    City:             current.City          ?? '',
    State:            current.State         ?? '',
    Zip:              current.Zip           ?? '',
  }

  await call<unknown>('/management/1/workOrderDetails', { method: 'PATCH', json: body })
}

// ─────────────────────────────────────────────────────────────────────
// Update work-order status — mirrors MAIA's TicketStatus changes to
// CINC. Two endpoints based on whether we're reopening:
//   PATCH /workOrderStatus        — any transition that isn't a reopen
//   PATCH /workOrderStatusReopen  — moving FROM a completed CINC status
//                                   BACK to an open one (CINC blocks
//                                   plain workOrderStatus calls here).
// Both take a PascalCase body. Note field is required by CINC and
// shows up as a system-generated note on the work order.
// ─────────────────────────────────────────────────────────────────────
export interface UpdateWorkOrderStatusInput {
  workOrderId:        number
  workOrderStatusId:  number
  workOrderTypeId?:   number | null   // required when CINC is being asked to reopen
  note?:              string | null
}

export async function updateWorkOrderStatus(
  input: UpdateWorkOrderStatusInput,
): Promise<void> {
  // Inspect current CINC state to decide which endpoint to use. The
  // reopen-vs-normal decision can't be made locally because MAIA's
  // status may already match CINC's by the time the outbox drains.
  const [current, statuses] = await Promise.all([
    getWorkOrderById(input.workOrderId),
    listWorkOrderStatuses(),
  ])
  if (!current) {
    throw new CincApiError(`Cannot fetch CINC work order ${input.workOrderId} to update status`)
  }
  const currentStatus = statuses.find(s => s.WorkOrderStatusId === current.WorkOrderStatusId)
  const newStatus     = statuses.find(s => s.WorkOrderStatusId === input.workOrderStatusId)
  const isReopen      = currentStatus?.IsCompleted === 1 && newStatus?.IsCompleted !== 1

  const body: Record<string, unknown> = {
    WorkOrderId:             input.workOrderId,
    WorkOrderStatusId:       input.workOrderStatusId,
    Note:                    (input.note ?? '').slice(0, 4000),
    IsPublic:                false,
    IsEmailedToVendor:       false,
    IsEmailedToWorkLocation: false,
  }
  if (isReopen) {
    body.WorkOrderTypeId = input.workOrderTypeId ?? current.WorkOrderTypId ?? null
  }

  const endpoint = isReopen
    ? '/management/1/workOrderStatusReopen'
    : '/management/1/workOrderStatus'
  await call<unknown>(endpoint, { method: 'PATCH', json: body })
}

/** Map our local TicketStatus to a CINC WorkOrderStatusId by tenant.
 *
 *  Two rules:
 *  - Anchor on IsCompleted (0/1) to stay on the right side of the catalog.
 *  - Among matches, prefer statuses with a positive WorkOrderStatusId.
 *    CINC's catalog includes system-default rows with NEGATIVE ids
 *    (e.g. "Pending Review" = -3, "Closed" = -2) that pass schema
 *    validation but DON'T actually move the status field — they just
 *    log a no-op audit note. The settable, tenant-configured statuses
 *    have positive ids ("Open", "Pending", "Closed", etc.).
 *
 *  Fallback: first row with the right IsCompleted, preferring positive
 *  ids again — so we never hard-fail just because CINC's tenant config
 *  doesn't include our keyword. */
export async function findCincStatusIdForTicketStatus(
  ticketStatus: 'open' | 'pending' | 'waiting_external' | 'resolved' | 'closed',
): Promise<number> {
  const statuses = await listWorkOrderStatuses()
  if (statuses.length === 0) throw new CincApiError('CINC returned no work order statuses')

  const pickSettable = (rows: WorkOrderStatus[]): number | undefined =>
    (rows.find(s => s.WorkOrderStatusId > 0) ?? rows[0])?.WorkOrderStatusId

  const find = (isCompleted: 0 | 1, needles: string[]): number | undefined => {
    const matches = statuses.filter(s =>
      s.IsCompleted === isCompleted &&
      needles.some(n => (s.WorkOrderStatusDescription ?? '').toLowerCase().includes(n))
    )
    return pickSettable(matches)
  }

  let id: number | undefined
  switch (ticketStatus) {
    case 'open':             id = find(0, ['open']);                                  break
    case 'pending':          id = find(0, ['pending']);                               break
    case 'waiting_external': id = find(0, ['awaiting', 'waiting', 'vendor', 'external', 'quote']); break
    // CINC tenants in our footprint don't distinguish "resolved" from
    // "closed" — both map to the single completed status ("Closed").
    case 'resolved':         id = find(1, ['closed', 'complete', 'resolved', 'done']); break
    case 'closed':           id = find(1, ['closed', 'cancel']);                       break
  }

  if (id === undefined) {
    const wantCompleted: 0 | 1 = (ticketStatus === 'resolved' || ticketStatus === 'closed') ? 1 : 0
    id = pickSettable(statuses.filter(s => s.IsCompleted === wantCompleted))
  }
  if (id === undefined) {
    throw new CincApiError(`No CINC status maps to ticket status "${ticketStatus}"`)
  }
  return id
}

// ─────────────────────────────────────────────────────────────────────
// Add note to existing work order
// ─────────────────────────────────────────────────────────────────────
export interface AddNoteOptions {
  isPublic?:               boolean
  emailToWorkLocation?:    boolean
  emailToVendor?:          boolean
}

export async function addWorkOrderNote(
  workOrderId: number,
  text:        string,
  opts:        AddNoteOptions = {},
): Promise<void> {
  await call('/management/1/workOrderNotes', {
    method: 'POST',
    query:  { workOrderId },
    json: [{
      noteDescription:             text.slice(0, 4000),
      isNotePublic:                opts.isPublic            ?? true,
      isNoteEmailedToWorkLocation: opts.emailToWorkLocation ?? false,
      isNoteEmailedToVendor:       opts.emailToVendor       ?? false,
    }],
  })
}

// ─────────────────────────────────────────────────────────────────────
// Inbound read helpers (Phase B-1 / B-2)
// ─────────────────────────────────────────────────────────────────────

/** Lists work orders created at or after the given ISO timestamp.
 *  CINC accepts `yyyy-mm-dd hh:mm:ss` in GMT for createdFromDate. */
export async function listWorkOrdersCreatedSince(cursorIso: string): Promise<CincWorkOrder[]> {
  // CINC's createdFromDate accepts ISO-ish; using the raw ISO string works
  // empirically. If we ever see CINC reject the format, switch to
  // `new Date(cursorIso).toISOString().replace('T', ' ').replace(/\..*$/, '')`.
  return await call<CincWorkOrder[]>('/management/1/workOrders', {
    method: 'GET',
    query:  { createdFromDate: cursorIso },
  }).catch(err => {
    // Empty result and 4xx for "no matches" come back as CincApiError —
    // treat as empty list, not a hard failure.
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincWorkOrder[]
    }
    throw err
  })
}

// ─────────────────────────────────────────────────────────────────────
// Homeowner + board lookups (used by /admin/cinc-sync)
//
// Field shapes confirmed by the probe in scripts/probe-cinc-homeowners.ts.
// CINC's PMITFP tenant has Contacts & Consent OFF, so the v2
// /management/2/homeowners/associationWithProperty endpoint returns 400
// — stick with v1.
// ─────────────────────────────────────────────────────────────────────

export interface CincPropertyAddress {
  PropertyAddressId:        number
  BillingTypeID?:           number
  FirstName?:               string | null
  LastName?:                string | null
  FirstName1?:              string | null
  LastName1?:               string | null
  StreetNumber?:            number | string | null
  Address?:                 string | null
  City?:                    string | null
  State?:                   string | null
  Zip?:                     string | null
  Email?:                   string | null
  HomePhone?:               string | null
  WorkPhone?:               string | null
  MobilePhone?:             string | null
  Address2?:                string | null
  AddressTypeId?:           number
  AddressTypeDescription?:  string | null
  OwnerAddress?:            boolean
}

export interface CincPropertyInfo {
  AssocID:        number
  AssocCode?:     string | null
  PropertyID:     number
  isCurrentOwner: boolean
  OwnerNumber?:   number
  PropertyHOID?:  string | null
  UnitNo?:        string | null
  PostedDate?:    string | null
  SettledDate?:   string | null
  Address:        CincPropertyAddress[]
}

export interface CincAssociationWithProperty {
  AssociationId:   number
  AssociationCode: string
  AssociationName: string
  PropertyInfo:    CincPropertyInfo[]
}

/** Pulls every unit + current-owner contact info for the given
 *  association. Each CincPropertyInfo's Address[] usually contains one
 *  row (the property address with the active owner). */
export async function listAssociationProperties(assocCode: string): Promise<CincPropertyInfo[]> {
  const data = await call<CincAssociationWithProperty[]>('/management/1/homeowners/associationWithProperty', {
    method: 'GET',
    query:  { assocCode: assocCode.toUpperCase() },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return []
    throw err
  })
  const wrap = (data ?? [])[0]
  return wrap?.PropertyInfo ?? []
}

export interface CincBoardMember {
  AssocCode:                 string
  AssocId:                   number
  BoardMemberId:             number
  BoardMemberName:           string | null
  BoardMemberTypeId?:        number
  BoardMemberType?:          string | null     // "President" / "Treasurer" / "Secretary" / etc.
  BoardCommitteeTypeId?:     number
  BoardCommittee?:           string | null
  BoardResponsibilityId?:    number
  BoardResponsibility?:      string | null
  TermExpiryDate?:           string | null
  BoardTitle?:               string | null
  AddressLine1?:             string | null
  AddressLine2?:             string | null
  City?:                     string | null
  State?:                    string | null
  Zip?:                      string | null
  HomePhone?:                string | null
  WorkPhone?:                string | null
  MobilePhone?:              string | null
  Email?:                    string | null
  PropertyAddressId?:        number
  PropertyContactId?:        number
  Comment?:                  string | null
}

export interface CincAssociationMeta {
  AssocId:           number
  AssocCode:         string
  AssociationName:   string
  Numberofunits:     number | null
  isActive:          boolean | null
}

/** Returns EVERY association configured in this CINC tenant. Used by
 *  the cinc-sync listing page to surface associations that exist in
 *  CINC but haven't been onboarded into MAIA yet, so staff can spin
 *  up a new association row + import its owners with one click. */
export async function listAllCincAssociations(): Promise<CincAssociationMeta[]> {
  interface Raw {
    AssocId?:          number
    AssociationIdLink?:string | null
    Associationname?:  string | null
    Numberofunits?:    number | null
    isActive?:         boolean | null
  }
  const list = await call<Raw[]>('/management/1/associations', { method: 'GET' })
    .catch(err => {
      if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return [] as Raw[]
      throw err
    })
  return (list ?? [])
    .filter(r => r.AssociationIdLink)
    .map(r => ({
      AssocId:         r.AssocId ?? 0,
      AssocCode:       (r.AssociationIdLink ?? '').toUpperCase(),
      AssociationName: r.Associationname ?? (r.AssociationIdLink ?? '').toUpperCase(),
      Numberofunits:   r.Numberofunits ?? null,
      isActive:        r.isActive ?? null,
    }))
}

/** Authoritative association metadata — primarily Numberofunits, which
 *  is the count to display in the UI (the property list endpoint can
 *  return multiple rows per unit when there are joint or historical
 *  owners). */
export async function getAssociationMeta(assocCode: string): Promise<CincAssociationMeta | null> {
  interface Raw {
    AssocId?:          number
    AssociationIdLink?:string | null
    Associationname?:  string | null
    Numberofunits?:    number | null
    isActive?:         boolean | null
  }
  const list = await call<Raw[]>('/management/1/associations', {
    method: 'GET',
    query:  { assocCode: assocCode.toUpperCase() },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return [] as Raw[]
    throw err
  })
  const hit = list.find(r => (r.AssociationIdLink ?? '').toUpperCase() === assocCode.toUpperCase()) ?? list[0]
  if (!hit) return null
  return {
    AssocId:         hit.AssocId ?? 0,
    AssocCode:       (hit.AssociationIdLink ?? assocCode).toUpperCase(),
    AssociationName: hit.Associationname ?? assocCode,
    Numberofunits:   hit.Numberofunits ?? null,
    isActive:        hit.isActive ?? null,
  }
}

/** Active board members for the association, sorted as CINC returns
 *  them (typically by position). */
export async function listAssociationBoardMembers(assocCode: string): Promise<CincBoardMember[]> {
  return await call<CincBoardMember[]>('/management/1/associations/boardMembers', {
    method: 'GET',
    query:  { assocCode: assocCode.toUpperCase() },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincBoardMember[]
    }
    throw err
  })
}

/** Fetches a single work order by ID, with notes / contacts / vendor
 *  info embedded. Returns null if CINC has no such work order. */
export async function getWorkOrderById(workOrderId: number): Promise<CincWorkOrder | null> {
  const list = await call<CincWorkOrder[]>('/management/1/workOrders', {
    method: 'GET',
    query:  { workOrderId },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincWorkOrder[]
    }
    throw err
  })
  return list.find(w => w.WorkOrderId === workOrderId) ?? null
}

/** Minimal vendor summary returned by /vendors and /vendorsBasic.
 *  The CINC payload has many more fields — we only model what the
 *  vendor-picker UI needs. */
export interface CincVendorSummary {
  VendorId:   number
  VendorName: string
}

/** Lists every vendor in the tenant's CINC. Used as the "all vendors"
 *  bucket of the vendor picker. */
export async function listVendors(): Promise<CincVendorSummary[]> {
  return await call<CincVendorSummary[]>('/management/1/vendorsBasic', {
    method: 'GET',
    query:  {},
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincVendorSummary[]
    }
    throw err
  })
}

/** Active vendors associated with a specific association on the Vendor
 *  Association Accounts screen in CINC. Used as the "this association"
 *  bucket of the vendor picker. */
export async function listVendorsForAssociation(assocCode: string): Promise<CincVendorSummary[]> {
  return await call<CincVendorSummary[]>('/management/1/vendors/vendorAssociation', {
    method: 'GET',
    query:  { assocCode: assocCode.toUpperCase() },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincVendorSummary[]
    }
    throw err
  })
}

/** Lists attachments (vendor photos, files) for a work order. CINC
 *  returns the bytes inline as base64; there is no separate download
 *  endpoint. Returns [] when CINC has none or returns 4xx. */
export async function listWorkOrderAttachments(workOrderId: number): Promise<CincAttachment[]> {
  return await call<CincAttachment[]>('/management/1/workOrderAttachments', {
    method: 'GET',
    query:  { workOrderId },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincAttachment[]
    }
    throw err
  })
}

// ─────────────────────────────────────────────────────────────────────
// Vendor catalog (rich shape) — for invoice intake matching
//
// CincVendorSummary (above) is the minimal shape the existing picker
// UIs use. CincVendorFull exposes the four UserDefined slots — we use
// UserDefined1 to store our internal "short name" for invoice file
// renaming (e.g. "Atlas" for "Atlas Electrical Performance LLC").
// ─────────────────────────────────────────────────────────────────────
export interface CincVendorFull {
  VendorId:      number
  VendorName:    string
  /** Doing-Business-As. Many vendors invoice under the DBA while CINC
   *  carries the legal name (or vice versa) — the fuzzy matcher checks
   *  this alongside VendorName + CheckName. */
  DBA?:          string  | null
  CheckName?:    string  | null
  Email?:        string  | null
  Phone?:        string  | null
  AddressLine1?: string  | null
  City?:         string  | null
  State?:        string  | null
  Zip?:          string  | null
  TaxId?:        string  | null
  UserDefined1?: string  | null  // our short_name
  UserDefined2?: string  | null
  UserDefined3?: string  | null
  UserDefined4?: string  | null
  Status?:       string  | null
  VendorType?:   string  | null
}

interface CachedVendorList { vendors: CincVendorFull[]; expiresAt: number }
let _vendorsFullCache: CachedVendorList | null = null
const VENDOR_CACHE_TTL_MS = 60 * 60_000  // 1 hour

/** Full vendor catalog (one container process holds it for an hour).
 *  Used by the invoice intake pipeline to fuzzy-match an extracted
 *  vendor name to a CINC VendorId before pushing the invoice. */
export async function listVendorsFull(opts?: { forceRefresh?: boolean }): Promise<CincVendorFull[]> {
  if (!opts?.forceRefresh && _vendorsFullCache && _vendorsFullCache.expiresAt > Date.now()) {
    return _vendorsFullCache.vendors
  }
  const vendors = await call<CincVendorFull[]>('/management/1/vendors', { method: 'GET', query: {} })
    .catch(err => {
      if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
        return [] as CincVendorFull[]
      }
      throw err
    })
  _vendorsFullCache = { vendors, expiresAt: Date.now() + VENDOR_CACHE_TTL_MS }
  return vendors
}

/** Force a refresh of the vendor cache — call after writing a new
 *  UserDefined1 (short name) or after Karen creates a vendor in CINC. */
export function invalidateVendorCache(): void {
  _vendorsFullCache = null
}

/** Write the short name into CINC's UserDefined1 field on the vendor
 *  record. Other fields untouched. */
export async function updateVendorShortName(vendorId: number, shortName: string): Promise<void> {
  await call<unknown>('/management/1/vendors/vendor', {
    method: 'PATCH',
    json:   { VendorId: vendorId, UserDefined1: shortName },
  })
  invalidateVendorCache()
}

/** Fuzzy-match an extracted vendor name against the CINC catalog.
 *  For each vendor we score the extracted name against THREE candidate
 *  fields — VendorName, DBA, and CheckName — and keep the best score
 *  per vendor. Invoices commonly use the DBA while CINC carries the
 *  legal name (e.g. "Smith Plumbing Services" on the invoice for
 *  vendor "John Smith Holdings LLC, DBA Smith Plumbing Services").
 *  Score = token-overlap ratio after normalisation. Returns the best
 *  candidate above 0.6, or null. Cheap — no Levenshtein dep. */
export function fuzzyMatchVendor(extractedName: string, catalog: CincVendorFull[]): CincVendorFull | null {
  const target = normalizeVendorName(extractedName)
  if (!target || target.length < 3) return null

  // Exact match (normalized) on any of the three fields wins outright.
  const exact = catalog.find(v =>
    normalizeVendorName(v.VendorName ?? '') === target ||
    normalizeVendorName(v.DBA        ?? '') === target ||
    normalizeVendorName(v.CheckName  ?? '') === target,
  )
  if (exact) return exact

  const targetTokens = new Set(target.split(' ').filter(t => t.length >= 3))
  if (targetTokens.size === 0) return null

  let best: { vendor: CincVendorFull; score: number } | null = null
  for (const v of catalog) {
    const score = Math.max(
      scoreAgainstField(targetTokens, v.VendorName),
      scoreAgainstField(targetTokens, v.DBA),
      scoreAgainstField(targetTokens, v.CheckName),
    )
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { vendor: v, score }
    }
  }
  return best?.vendor ?? null
}

function scoreAgainstField(targetTokens: Set<string>, candidate: string | null | undefined): number {
  if (!candidate) return 0
  const norm   = normalizeVendorName(candidate)
  const tokens = new Set(norm.split(' ').filter(t => t.length >= 3))
  if (tokens.size === 0) return 0
  let overlap = 0
  for (const t of targetTokens) if (tokens.has(t)) overlap++
  return overlap / Math.max(targetTokens.size, tokens.size)
}

function normalizeVendorName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|company|services?|of|the|and)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─────────────────────────────────────────────────────────────────────
// Invoice CRUD — used by the intake-queue push flow
// ─────────────────────────────────────────────────────────────────────
export interface CincInvoiceMatch {
  InvoiceId:      number
  InvoiceNumber?: string | null
  InvoiceDate?:   string | null
  InvoiceTotal?:  number | null
  VendorId?:      number | null
  AssocCode?:     string | null
}

/** GET /accounting/duplicateInvoices — CINC's built-in dup detection
 *  for a specific (assoc, vendor, invoice#) combo. Returns [] if none
 *  or on 4xx (treat as "no known duplicate"). */
export async function checkDuplicateInvoice(opts: {
  associationCode: string
  vendorId:        number
  invoiceNumber:   string
}): Promise<CincInvoiceMatch[]> {
  return await call<CincInvoiceMatch[]>('/management/1/accounting/duplicateInvoices', {
    method: 'GET',
    query:  {
      assocCode:     opts.associationCode.toUpperCase(),
      vendorId:      opts.vendorId,
      invoiceNumber: opts.invoiceNumber,
    },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincInvoiceMatch[]
    }
    throw err
  })
}

export interface CreateInvoiceInput {
  associationCode: string
  vendorId:        number
  invoiceNumber:   string
  invoiceDate:     string       // ISO date (YYYY-MM-DD)
  amount:          number
  description?:    string | null
  dueDate?:        string | null
}

export interface CreateInvoiceResult {
  invoiceId: number
}

/** POST /accounting/invoice — creates the invoice header. Caller
 *  follows up with attachInvoicePdf to upload the file. */
export async function createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const assocId = await findAssocIdByCode(input.associationCode)
  if (!assocId) {
    throw new CincApiError(
      `Cannot resolve CINC AssocId for association_code="${input.associationCode}". ` +
      `findAssocIdByCode derives this from existing work orders — create one in CINC ` +
      `for this association first to populate the cache, then retry the invoice push.`,
    )
  }
  const body = {
    assocId,
    vendorId:      input.vendorId,
    invoiceNumber: input.invoiceNumber,
    invoiceDate:   input.invoiceDate,
    invoiceTotal:  input.amount,
    description:   input.description?.slice(0, 1000) ?? '',
    dueDate:       input.dueDate ?? undefined,
  }
  const result = await call<{ InvoiceId?: number; invoiceId?: number }>(
    '/management/1/accounting/invoice',
    { method: 'POST', json: body },
  )
  const invoiceId = result.InvoiceId ?? result.invoiceId
  if (!invoiceId) throw new CincApiError('createInvoice succeeded but response had no InvoiceId')
  return { invoiceId }
}

// ─────────────────────────────────────────────────────────────────────
// Budget / GL lookup — drives the GL dropdown on the invoice intake
// form so Karen can only pick codes the association actually budgets
// for. Keeps expenses lining up with budget categories in reports.
// ─────────────────────────────────────────────────────────────────────
/** Actual CINC budget-line shape, per Swagger
 *  /management/1/accounting/budget/association/{assocCode}:
 *    { ChartID, GLAccountNumber, GLAccountDescription, AnnualBudget,
 *      Actual, Remaining }
 *  (Note CINC uses "GL" with capital L, ChartID — not GlAccountId.) */
export interface CincBudgetLine {
  ChartID?:              number | string | null
  GLAccountNumber?:      string | null
  GLAccountDescription?: string | null
  AnnualBudget?:         number | null
  Actual?:               number | null
  Remaining?:            number | null
}

/** Normalised shape we feed the dropdown. id/name guaranteed; budget
 *  fields optional but very useful — surfacing "actual / remaining"
 *  on the dropdown lets Karen pick the line with budget still left. */
export interface BudgetGlOption {
  id:        string
  number:    string | null   // e.g. "5000"
  name:      string          // e.g. "Repairs and Maintenance"
  budget:    number | null   // annual budget for this line
  actual:    number | null   // spent year-to-date
  remaining: number | null   // budget - actual
}

interface CachedBudget { lines: BudgetGlOption[]; expiresAt: number }
const _budgetCache  = new Map<string, CachedBudget>()
const BUDGET_TTL_MS = 30 * 60_000  // 30 min — budgets change infrequently

/** Fetch the budget for an association and reduce it to a clean list
 *  of GL options. Cached for 30 min per assoc code. Returns [] on a
 *  4xx (so callers can render an empty dropdown gracefully). */
export async function getAssociationBudget(
  assocCode: string,
  opts?:     { forceRefresh?: boolean },
): Promise<BudgetGlOption[]> {
  const key = assocCode.toUpperCase()
  if (!opts?.forceRefresh) {
    const hit = _budgetCache.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.lines
  }

  const raw = await call<CincBudgetLine[]>(
    `/management/1/accounting/budget/association/${encodeURIComponent(key)}`,
    { method: 'GET' },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincBudgetLine[]
    }
    throw err
  })

  const seen  = new Set<string>()
  const lines: BudgetGlOption[] = []
  for (const r of raw) {
    // ChartID is the unique CINC handle (despite the GL-* naming on the
    // sibling fields). Treat 0 as null because that's the Swagger default.
    const idRaw = r.ChartID
    const id    = idRaw != null && idRaw !== 0 ? String(idRaw) : null
    if (!id || seen.has(id)) continue
    const name = (r.GLAccountDescription ?? '').trim()
    if (!name) continue
    seen.add(id)
    lines.push({
      id,
      number:    r.GLAccountNumber ?? null,
      name,
      budget:    typeof r.AnnualBudget === 'number' ? r.AnnualBudget : null,
      actual:    typeof r.Actual      === 'number' ? r.Actual      : null,
      remaining: typeof r.Remaining   === 'number' ? r.Remaining   : null,
    })
  }
  // Sort by GL number when available (typical accounting expectation),
  // falling back to name.
  lines.sort((a, b) => {
    if (a.number && b.number) return a.number.localeCompare(b.number, undefined, { numeric: true })
    return a.name.localeCompare(b.name)
  })

  _budgetCache.set(key, { lines, expiresAt: Date.now() + BUDGET_TTL_MS })
  return lines
}

export function invalidateBudgetCache(assocCode?: string): void {
  if (assocCode) _budgetCache.delete(assocCode.toUpperCase())
  else           _budgetCache.clear()
}

/** PUT /associations/InvoiceAttachmentsBase64 — attach a single PDF
 *  to a CINC invoice. CINC's hard limit is 25 MB pre-conversion. */
export async function attachInvoicePdf(opts: {
  invoiceId: number
  pdfBase64: string
  filename:  string
}): Promise<{ imageId: number }> {
  const result = await call<{ ImageId?: number; imageId?: number }>(
    '/management/1/associations/InvoiceAttachmentsBase64',
    {
      method: 'PUT',
      json:   { InvoiceId: opts.invoiceId, FileName: opts.filename, FileContent: opts.pdfBase64 },
    },
  )
  const imageId = result.ImageId ?? result.imageId
  if (!imageId) throw new CincApiError('attachInvoicePdf succeeded but response had no ImageId')
  return { imageId }
}
