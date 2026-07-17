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

/** Fetch a CINC document binary by ImageID — the invoice/attachment scan that
 *  lives behind GET /management/1/document/{ImageID}. Returns the raw bytes +
 *  content type (PDF/image), or null on failure. */
export async function getCincDocument(imageId: number): Promise<{ bytes: Buffer; contentType: string; filename?: string } | null> {
  const url = `${API_BASE}/management/1/document/${imageId}`
  let res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } })
  if (res.status === 401) { _token = null; res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } }) }
  if (!res.ok) return null

  const sniff = (bytes: Buffer, name = ''): string => {
    const sig = bytes.subarray(0, 4).toString('latin1'); const n = name.toLowerCase()
    if (sig === '%PDF' || n.endsWith('.pdf'))            return 'application/pdf'
    if (sig.startsWith('\x89PNG') || n.endsWith('.png')) return 'image/png'
    if (sig.startsWith('\xFF\xD8') || /\.jpe?g$/.test(n)) return 'image/jpeg'
    return 'application/octet-stream'
  }

  const ct = res.headers.get('content-type') ?? ''
  // CINC returns JSON: [{ FileName, FileType, FileData (base64) }] — decode the
  // base64 to the real binary (NOT raw bytes, despite the endpoint name).
  if (/json/i.test(ct)) {
    let parsed: unknown
    try { parsed = await res.json() } catch { return null }
    const arr = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ FileName?: string; FileData?: string }>
    const file = arr.find(f => f?.FileData) ?? arr[0]
    if (!file?.FileData) return null
    const bytes = Buffer.from(file.FileData, 'base64')
    return { bytes, contentType: sniff(bytes, file.FileName ?? ''), filename: file.FileName ?? undefined }
  }

  // Fallback: a raw-binary response.
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, contentType: (ct && !/octet-stream/i.test(ct)) ? ct : sniff(bytes) }
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
// have our string `association_code`. Primary lookup: GET
// /workOrders?assocCode=<code> and grab `AssocId` off the first matching
// row. Fallback (when the association has no work orders in CINC yet):
// GET /associations?assocCode=<code>, which exposes the AssocId
// regardless of WO count. Cached per container. Returns null only if the
// code is unknown to CINC entirely.
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
  if (hit) {
    _assocIdCache.set(key, hit.AssocId)
    return hit.AssocId
  }

  // Fallback: an association with ZERO work orders in CINC returns nothing
  // above, which used to force "manually create one WO first". But the
  // /associations endpoint exposes the AssocId regardless of WO count, so
  // resolve from there instead. Verified 2026-06-07: for every association
  // we sync, the AssocId from /associations is identical to the one on its
  // existing work orders — so this is safe and removes the manual-seed step.
  const meta = await getAssociationMeta(key).catch(() => null)
  if (meta?.AssocId) {
    _assocIdCache.set(key, meta.AssocId)
    return meta.AssocId
  }
  return null
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

  // CINC's WorkOrder.Description column caps at 100 chars and hard-rejects
  // (400 "description should not exceed 100 characters") — it does NOT
  // silently truncate. Collapse whitespace and cap at 100 for the title;
  // the full subject+summary rides along in `notes` (4000-char limit).
  const description = input.description.replace(/\s+/g, ' ').trim().slice(0, 100)

  const body: Record<string, unknown> = {
    assocId,
    workOrderTypeId:   typeId,
    workOrderStatusId: statusId,
    description,
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

/** List currently-open work orders for an association, optionally
 *  filtered to a single vendor. Used by the invoice intake form so
 *  Karen can link a maintenance invoice to an existing WO instead of
 *  it landing standalone. Filter for "open" is a description-text
 *  heuristic — CINC's status enum varies per tenant so excluding
 *  obviously-terminal statuses (complete/closed/void) is more robust
 *  than trying to whitelist "open"/"pending" exactly. */
export async function listOpenWorkOrders(opts: {
  assocCode: string
  vendorId?: number
  limit?:    number
  /** Include completed/closed WOs too (NOT void/cancelled). For linking an
   *  invoice to a WO — invoices usually arrive AFTER the work is done. */
  includeCompleted?: boolean
  /** PREFERENCE (not a hard filter): sort WOs for this vendor first but still
   *  return the rest. CINC WOs frequently have NO vendor (or one that lags the
   *  MAIA-side reassignment), so a hard vendor filter hid the right WO. Use this
   *  for the invoice → WO picker so the WO is always selectable. */
  vendorPreferred?: number
}): Promise<CincWorkOrder[]> {
  const list = await call<CincWorkOrder[]>('/management/1/workOrders', {
    method: 'GET',
    query:  { assocCode: opts.assocCode.toUpperCase() },
  }).catch(() => [] as CincWorkOrder[])

  const open = list.filter(w => {
    if (opts.vendorId && w.VendorId !== opts.vendorId) return false   // hard vendor filter (legacy callers)
    const status = (w.WorkOrderStatus ?? '').toLowerCase()
    return opts.includeCompleted
      ? !/void|cancel/.test(status)             // drop only void/cancelled
      : !/complete|closed|void|cancel/.test(status)
  })

  const pref = opts.vendorPreferred
  return open
    .sort((a, b) => {
      if (pref) {
        const am = a.VendorId === pref ? 0 : 1
        const bm = b.VendorId === pref ? 0 : 1
        if (am !== bm) return am - bm                 // vendor-matched WOs first
      }
      return new Date(b.CreatedDate ?? 0).getTime() - new Date(a.CreatedDate ?? 0).getTime()
    })
    .slice(0, opts.limit ?? 25)
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
 *  row (the property address with the active owner).
 *
 *  CINC ANNOUNCED (doc 12/19/2025): a "Contacts and Consent" feature
 *  will move FirstName/LastName/Email/Phone/BillingTypeID/OwnerAddress
 *  OUT of the address array and into a separate Contacts module. When
 *  CINC turns the feature on for our tenant:
 *    - This v1 endpoint will stop working.
 *    - We must call v2 (/management/2/homeowners/associationWithProperty)
 *      AND a second call (/management/1/homeowners/propertyContacts) to
 *      get the contact fields.
 *  Detection: getContactsAndConsentFlag() — see below.
 *  Currently OFF on PMITFP (probed 2026-05-29: IsContactsFlagOn=false).
 *  Until enabled, v1 stays correct. We also warn loudly if the flag
 *  flips so we get advance notice instead of a silent break. */
export async function listAssociationProperties(assocCode: string): Promise<CincPropertyInfo[]> {
  // Best-effort: log once if CINC has enabled the Contacts and Consent
  // feature but we haven't shipped the v2 path yet. Don't throw — we
  // want the v1 call to attempt anyway so the failure mode is the
  // CINC 400 ("use v1 instead") rather than a code-level abort.
  const flag = await getContactsAndConsentFlag().catch(() => null)
  if (flag === true) {
    console.warn(
      '[CINC] Contacts and Consent feature is ENABLED on this tenant. ' +
      'listAssociationProperties is still calling v1 — migrate to v2 + propertyContacts. ' +
      'See CINC_API.md "Contacts and Consent migration".',
    )
  }

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

// ─────────────────────────────────────────────────────────────────────
// CINC "Contacts and Consent" feature flag (doc dated 12/19/2025).
//
// CINC is rolling out a new Contacts module that splits homeowner
// contact info (name / email / phone / mailing-address selection /
// consent preferences) out of the per-address record and into a
// dedicated "Contacts" tab on the Homeowner Information screen.
//
// Six existing endpoints get v2 versions; one (updateEmailPhone) is
// retired; five new endpoints land (propertyContacts, propertyContactTypes,
// PATCH propertyContact, PUT propertyContactMailingAddressSelection,
// and this flag-check endpoint). Old endpoints CEASE TO FUNCTION once
// the feature is enabled for our tenant.
//
// MAIA blast radius today: only listAssociationProperties (uses the
// v1 associationWithProperty endpoint). The other 5 endpoints in the
// migration list aren't called by MAIA.
//
// Probed 2026-05-29 on PMITFP tenant: IsContactsFlagOn=false. So we're
// safe to keep using v1 today. This helper polls the flag so we can
// detect the moment CINC flips it on for us. See CINC_API.md.
// ─────────────────────────────────────────────────────────────────────
interface CachedContactsFlag { value: boolean; expiresAt: number }
let _contactsFlagCache: CachedContactsFlag | null = null
const CONTACTS_FLAG_TTL_MS = 15 * 60_000  // 15 min — flag changes infrequently

/** GET /management/1/homeowners/contactsFlag — returns whether the
 *  Contacts and Consent feature is enabled for our CINC tenant. When
 *  TRUE, v1 endpoints that overlap with the new module will stop
 *  working; we must migrate to v2 + propertyContacts.
 *
 *  Returns null on transport/HTTP errors so callers can fall through
 *  to the legacy path safely. */
export async function getContactsAndConsentFlag(opts?: { forceRefresh?: boolean }): Promise<boolean | null> {
  if (!opts?.forceRefresh && _contactsFlagCache && _contactsFlagCache.expiresAt > Date.now()) {
    return _contactsFlagCache.value
  }
  const data = await call<{ IsContactsFlagOn?: boolean }>(
    '/management/1/homeowners/contactsFlag',
    { method: 'GET' },
  ).catch(err => {
    if (err instanceof CincApiError) return null
    throw err
  })
  if (!data || typeof data.IsContactsFlagOn !== 'boolean') return null
  _contactsFlagCache = { value: data.IsContactsFlagOn, expiresAt: Date.now() + CONTACTS_FLAG_TTL_MS }
  return data.IsContactsFlagOn
}

export function invalidateContactsFlagCache(): void {
  _contactsFlagCache = null
}

// ─────────────────────────────────────────────────────────────────────
// Contacts and Consent v2 — readiness scaffolding (2026-07-15).
//
// Shapes below are pulled directly from CINC's live public Swagger
// (https://integration.cincsys.io/api/swagger/docs/1.40.0 — no auth
// required), NOT the static QRG PDF, which undersells what v2 actually
// returns. Confirmed live-probed 2026-07-15: PMITFP prod tenant still
// has IsContactsFlagOn=false, so NONE of this is wired into the active
// v1 code path (listAssociationProperties above is untouched and still
// v1-only). This is preparatory only.
//
// ⚠ UNRESOLVED GAP — do not route to v2 until this is settled:
// PropertyInformationV2Vm (the v2 associationWithProperty per-property
// row) has NO `isCurrentOwner` or `OwnerNumber` fields — both exist on
// every v1 shape (PropertyInformationVm, HomeownerLookupVm) but are
// absent from every v2 shape we could find in Swagger. lib/cinc-sync.ts
// buildSyncPreview() filters `cincProperties.filter(p => p.isCurrentOwner)`
// and uses OwnerNumber-style dual-slot rows to represent joint owners —
// this is the load-bearing CINC↔MAIA owner-reconciliation feature.
//
// Working hypothesis (UNVERIFIED — no sandbox credentials yet to test
// live): v2 restructured the model rather than just relocating fields.
// v1 represented joint owners as TWO separate PropertyInfo rows (one
// per OwnerNumber slot) and mixed in historical-owner rows filtered by
// isCurrentOwner. v2's PropertyInformationV2Vm instead embeds BOTH
// contacts directly on one row (PropertyContact1FirstName/LastName +
// PropertyContact2FirstName/LastName), which would make OwnerNumber
// unnecessary — and may mean this endpoint only ever returns the
// CURRENT owner per property now (no historical rows to filter out),
// which would make isCurrentOwner unnecessary too. listAssociationPropertiesV2
// below assumes this and treats every returned property as current
// (isCurrentOwner: true) — VERIFY against the CINC sandbox
// (https://ccintegration.cincsys.io, credentials pending) or ask CINC
// support directly before enabling this path in listAssociationProperties().
// ─────────────────────────────────────────────────────────────────────

/** GET /management/1/homeowners/propertyContacts response shape
 *  (HomeownerPropertyContactVm in CINC's Swagger). One row per contact
 *  on a homeowner's Contacts tab — richer than what associationWithProperty
 *  v2 exposes (secondary email, consent preference, tenant/board flags),
 *  but NOT required for MAIA's current field usage (see
 *  listAssociationPropertiesV2 below, which reconstructs everything
 *  MAIA actually reads from the v2 associationWithProperty call alone). */
export interface CincPropertyContact {
  AssocId?:               number
  AssocCode?:             string | null
  HoId?:                  string | null
  PropertyId?:            number
  PropertyContactId?:     number
  ContactFirstName?:      string | null
  ContactLastName?:       string | null
  BusinessName?:          string | null
  UseBusinessName?:       boolean | null
  PropertyContactTypeId?: number
  PropertyContactType?:   string | null
  ContactHomePhone?:      string | null
  ContactWorkPhone?:      string | null
  ContactMobilePhone?:    string | null
  ContactEmail?:          string | null
  ContactSecondaryEmail?: string | null
  ContactPreference?:     number   // 0=Email, 1=Mail, 2=Both
  IsOwner?:               boolean
  IsBoardCommitteeMember?: boolean
  IsTenant?:              boolean
  IsPreviousTenant?:      boolean
}

/** GET /management/1/homeowners/propertyContacts — returns every
 *  contact on a homeowner's Contacts tab. Swagger declares a single
 *  HomeownerPropertyContactVm as the response schema, but (like several
 *  other CINC list endpoints — see postApprovedInvoice above) it very
 *  likely returns an array in practice for a property with multiple
 *  contacts; handled defensively either way. Not yet called by any
 *  MAIA code path — exists so it's ready if the isCurrentOwner gap
 *  above turns out to require a per-contact ownership check. */
export async function listPropertyContacts(propertyId: number): Promise<CincPropertyContact[]> {
  const data = await call<CincPropertyContact[] | CincPropertyContact>(
    '/management/1/homeowners/propertyContacts',
    { method: 'GET', query: { propertyId } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return []
    throw err
  })
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

/** v2 per-address row (PropertyContactShortenedMailingAddressVm) — note
 *  there is NO OwnerAddress boolean in v2 (unlike v1's CincPropertyAddress);
 *  "is this the offsite/billing address" must be derived from
 *  AddressTypeDescription text instead. */
export interface CincPropertyContactAddressV2 {
  PropertyAddressId?:       number
  AddressTypeId?:           number
  AddressTypeDescription?:  string | null
  StreetNumber?:            number | string | null
  AddressLine1?:            string | null
  AddressLine2?:            string | null
  Unit?:                    string | null
  City?:                    string | null
  State?:                   string | null
  Zip?:                     string | null
  Country?:                 string | null
}

/** v2 per-property row (PropertyInformationV2Vm). Contact names/phone/
 *  email now live directly here (once per property) instead of per
 *  address — see the module comment above for the isCurrentOwner /
 *  OwnerNumber gap. */
export interface CincPropertyInfoV2 {
  AssocId?:                     number
  AssocCode?:                   string | null
  AssociationName?:             string | null
  PropertyId:                   number
  HoId?:                        string | null
  PropertyContact1FirstName?:   string | null
  PropertyContact1LastName?:    string | null
  PropertyContact2FirstName?:   string | null
  PropertyContact2LastName?:    string | null
  HomePhone?:                   string | null
  WorkPhone?:                   string | null
  MobilePhone?:                 string | null
  PropertyContact1Email?:       string | null
  BillingTypeId?:                number
  BillingType?:                  string | null
  UnitNo?:                      string | null
  PostedDate?:                  string | null
  SettledDate?:                 string | null
  Addresses?:                   CincPropertyContactAddressV2[]
}

interface CincPropertyInfoByAssociationV2 {
  Properties: CincPropertyInfoV2[]
}

/** NOT YET WIRED IN — see the ⚠ UNRESOLVED GAP comment above. Calls
 *  GET /management/2/homeowners/associationWithProperty and reconstructs
 *  the v1 CincPropertyInfo[] shape (two synthetic Address rows per
 *  property — a "Property Address" row carrying names/phone/email, and
 *  the real offsite/billing row from v2's Addresses[]) so existing
 *  consumers (lib/cinc-sync.ts snapshotsFromCincProperty, the owner ACH
 *  routes) can keep reading CincPropertyAddress.FirstName / .LastName /
 *  .FirstName1 / .LastName1 / .Email / phones / .OwnerAddress exactly
 *  as they do today. isCurrentOwner is hardcoded true (see gap comment);
 *  OwnerNumber is omitted (undefined) since v2 has no equivalent
 *  concept — joint owners are both embedded in one row now. */
export async function listAssociationPropertiesV2(assocCode: string): Promise<CincPropertyInfo[]> {
  console.warn(
    '[CINC] listAssociationPropertiesV2 called — this path assumes every ' +
    'v2 associationWithProperty row is the current owner (isCurrentOwner ' +
    'gap, see lib/integrations/cinc.ts). Confirm against the CINC sandbox ' +
    'or with CINC support before trusting this in a live sync.',
  )
  const wrap = await call<CincPropertyInfoByAssociationV2>('/management/2/homeowners/associationWithProperty', {
    method: 'GET',
    query:  { assocCode: assocCode.toUpperCase() },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return null
    throw err
  })
  const properties = wrap?.Properties ?? []

  return properties.map((p): CincPropertyInfo => {
    const addresses = p.Addresses ?? []
    const offsite    = addresses.find(a => /offsite/i.test(a.AddressTypeDescription ?? '')) ?? null
    const propertyLoc = addresses.find(a => !/offsite/i.test(a.AddressTypeDescription ?? '')) ?? addresses[0] ?? null

    // Synthetic "Property Address" row — carries the dual-contact names
    // + phone + email that v1 stored per-address and v2 now stores
    // once per property. Mirrors v1's OwnerAddress=false row.
    const propertyAddressRow: CincPropertyAddress = {
      PropertyAddressId:       propertyLoc?.PropertyAddressId ?? 0,
      FirstName:               p.PropertyContact1FirstName ?? null,
      LastName:                p.PropertyContact1LastName ?? null,
      FirstName1:              p.PropertyContact2FirstName ?? null,
      LastName1:               p.PropertyContact2LastName ?? null,
      StreetNumber:            propertyLoc?.StreetNumber ?? null,
      Address:                 propertyLoc?.AddressLine1 ?? null,
      City:                    propertyLoc?.City ?? null,
      State:                   propertyLoc?.State ?? null,
      Zip:                     propertyLoc?.Zip ?? null,
      Email:                   p.PropertyContact1Email ?? null,
      HomePhone:               p.HomePhone ?? null,
      WorkPhone:               p.WorkPhone ?? null,
      MobilePhone:             p.MobilePhone ?? null,
      Address2:                propertyLoc?.AddressLine2 ?? null,
      AddressTypeId:           propertyLoc?.AddressTypeId,
      AddressTypeDescription:  propertyLoc?.AddressTypeDescription ?? 'Property Address',
      OwnerAddress:            false,
    }

    const rows: CincPropertyAddress[] = [propertyAddressRow]
    if (offsite) {
      rows.push({
        PropertyAddressId:       offsite.PropertyAddressId ?? 0,
        StreetNumber:            offsite.StreetNumber ?? null,
        Address:                 offsite.AddressLine1 ?? null,
        City:                    offsite.City ?? null,
        State:                   offsite.State ?? null,
        Zip:                     offsite.Zip ?? null,
        Address2:                offsite.AddressLine2 ?? null,
        AddressTypeId:           offsite.AddressTypeId,
        AddressTypeDescription:  offsite.AddressTypeDescription ?? 'Owner’s Offsite Address',
        OwnerAddress:            true,
      })
    }

    return {
      AssocID:        p.AssocId ?? 0,
      AssocCode:       p.AssocCode ?? assocCode,
      PropertyID:      p.PropertyId,
      // ⚠ ASSUMPTION — see module comment. v2 has no isCurrentOwner field;
      // treating every returned row as current until verified otherwise.
      isCurrentOwner:  true,
      OwnerNumber:     undefined,
      PropertyHOID:    p.HoId ?? null,
      UnitNo:          p.UnitNo ?? null,
      PostedDate:      p.PostedDate ?? null,
      SettledDate:     p.SettledDate ?? null,
      Address:         rows,
    }
  })
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
  // The vendorAssociation response keys the id as `VendorID` (capital D) — NOT
  // `VendorId` — so reading `.VendorId` silently yields undefined, which broke
  // enrichment, compliance lookups (getVendorComplianceStatus(undefined)), and
  // association scoping. Normalize the raw rows to a real numeric VendorId.
  const raw = await call<Array<Record<string, unknown>>>('/management/1/vendors/vendorAssociation', {
    method: 'GET',
    query:  { assocCode: assocCode.toUpperCase() },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as Array<Record<string, unknown>>
    }
    throw err
  })
  return (Array.isArray(raw) ? raw : [])
    .map(r => ({ VendorId: Number(r.VendorID ?? r.VendorId ?? 0), VendorName: String(r.VendorName ?? '') }))
    .filter(v => v.VendorId > 0)
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
// Field names verified against the live /management/1/vendors response
// (2026-05-29). CINC uses Dba / ZipCode / TaxID / Address1 / Phone1 — the
// older PascalCase guesses (DBA / Zip / TaxId / AddressLine1 / Phone) never
// matched, so the fuzzy matcher's DBA check was silently dead.
export interface CincVendorFull {
  VendorId:      number
  VendorName:    string
  /** Doing-Business-As. Many vendors invoice under the DBA while CINC
   *  carries the legal name (or vice versa) — the fuzzy matcher checks
   *  this alongside VendorName + CheckName. */
  Dba?:          string  | null
  CheckName?:    string  | null
  Email?:        string  | null
  Phone1?:       string  | null
  Address1?:     string  | null
  City?:         string  | null
  State?:        string  | null
  ZipCode?:      string  | null
  TaxID?:        string  | null
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

// ─────────────────────────────────────────────────────────────────────
// Vendor record write — PATCH /management/1/vendors/vendor. Only VendorID
// is required; we send ONLY the fields the caller passes, so unrelated
// data is never clobbered. Used by the "Apply to CINC vendor" action to
// write ACH banking (Routing/Account/AccountType) + W-9 (TaxID/Exempt/
// 1099) extracted from a vendor-uploaded document.
//
// NOTE on field name: Swagger's PATCH body uses `VendorID` (capital D),
// while updateVendorShortName above uses `VendorId` and works — CINC
// accepts both casings. We send `VendorID` per the documented model.
// ─────────────────────────────────────────────────────────────────────
export interface VendorRecordWrite {
  TaxID?:          string | null
  Exempt?:         boolean | null
  VendorTypeID?:   string | null
  Print1099Type?:  number | null
  Ten99Box10?:     boolean | null
  CheckName?:      string | null
  Email?:          string | null
  NotificationEmail?: string | null
  NetTerm?:        number | null
  Routing?:        string | null
  Account?:        string | null
  AccountType?:    number | null
}

export async function updateVendorRecord(vendorId: number, fields: VendorRecordWrite): Promise<void> {
  // Drop undefined keys so we only PATCH what the caller set.
  const body: Record<string, unknown> = { VendorID: vendorId }
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) body[k] = v
  }
  await call<unknown>('/management/1/vendors/vendor', { method: 'PATCH', json: body })
  invalidateVendorCache()
}

export interface HomeownerAchWrite {
  propertyAddressId: number          // the OwnerAddress=true row (from listAssociationProperties)
  propertyId:        number          // for SetAchDate
  billingTypeId?:    number          // 3 = Automatic ACH (confirmed via ONE701)
  routing?:          string
  account?:          string
  accountType?:      number          // 1 = checking, 2 = savings (per the vendor pattern)
  achStartDate?:     string          // 'YYYY-MM-DD'
}

/** Write a homeowner's ACH / autopay setup into CINC: billing type → Automatic
 *  ACH plus the bank fields, then the ACH start date.
 *  ⚠ Best-effort: `/homeowners/updateBillingType` 404'd in prod; trying the
 *  documented `/billing/billingType` next. The exact path/body still needs
 *  confirming from CINC's network tab (save an ACH in the CINC UI). Each call is
 *  catch-wrapped so we return both responses for the audit instead of throwing. */
export async function setHomeownerAch(w: HomeownerAchWrite): Promise<{ billing: unknown; achDate: unknown }> {
  const billingBody: Record<string, unknown> = {
    PropertyAddressId: w.propertyAddressId,
    PropertyID:        w.propertyId,
    BillingTypeID:     w.billingTypeId ?? 3,
  }
  if (w.routing)             billingBody.Routing     = w.routing
  if (w.account)             billingBody.Account     = w.account
  if (w.accountType != null) billingBody.AccountType = w.accountType

  const billing = await call<unknown>('/management/1/billing/billingType', { method: 'PATCH', json: billingBody })
    .catch(e => ({ error: e instanceof Error ? e.message : String(e) }))
  let achDate: unknown = null
  if (w.achStartDate) {
    achDate = await call<unknown>(`/management/1/homeowners/${w.propertyId}/SetAchDate`, { method: 'PATCH', json: { AchStartDate: w.achStartDate } })
      .catch(e => ({ error: e instanceof Error ? e.message : String(e) }))
  }
  return { billing, achDate }
}

/** CINC's read-only vendor-type catalog (GET /vendors/vendorType). Used to
 *  assign a VendorTypeID to a vendor — CINC has no create-type endpoint, so
 *  trades CINC lacks are handled as MAIA-local overrides instead. */
export interface CincVendorType { id: string; name: string }
export async function listVendorTypes(): Promise<CincVendorType[]> {
  const raw = await call<Array<Record<string, unknown>>>('/management/1/vendors/vendorType', { method: 'GET', query: {} }).catch(() => [])
  return (raw ?? [])
    .map(t => ({
      id:   String(t.VendorTypeID ?? t.VendorTypeId ?? t.Id ?? t.ID ?? t.Value ?? ''),
      name: String(t.VendorType ?? t.Description ?? t.VendorTypeName ?? t.Name ?? t.Text ?? '').trim(),
    }))
    .filter(t => t.id && t.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ─────────────────────────────────────────────────────────────────────
// Create a new vendor — POST /management/1/vendors. Verified live
// (2026-06-15): body { Name, VendorTypeID, Email, Phone1, Address1, City,
// State, ZipCode, Status:-1 } → 201 { VendorId, ... }. Only Name is
// effectively required; VendorTypeID 16 = "Not Assigned". Status -1 = Active.
// Used by vendor onboarding to create the CINC record before collecting docs.
// ─────────────────────────────────────────────────────────────────────
export interface CreateVendorInput {
  name:          string
  email?:        string | null
  phone?:        string | null
  address1?:     string | null
  city?:         string | null
  state?:        string | null
  zip?:          string | null
  vendorTypeId?: string | null   // CINC VendorTypeID; defaults to 16 (Not Assigned)
}
export async function createVendor(input: CreateVendorInput): Promise<{ vendorId: number }> {
  const body: Record<string, unknown> = {
    Name:         input.name,
    VendorTypeID: input.vendorTypeId ?? '16',
    Status:       -1,
  }
  if (input.email)    body.Email    = input.email
  if (input.phone)    body.Phone1   = input.phone
  if (input.address1) body.Address1 = input.address1
  if (input.city)     body.City     = input.city
  if (input.state)    body.State    = input.state
  if (input.zip)      body.ZipCode  = input.zip
  const res = await call<{ VendorId?: number; VendorID?: number }>('/management/1/vendors', { method: 'POST', json: body })
  const vendorId = res?.VendorId ?? res?.VendorID
  if (!vendorId) throw new CincApiError('createVendor: no VendorId in response')
  invalidateVendorCache()
  return { vendorId }
}

// ─────────────────────────────────────────────────────────────────────
// Single-vendor detail — used by the invoice intake card to show
// Karen the CINC-side defaults (payment method, terms, 1099 status,
// banking) so she can verify her Pay By selection matches CINC's
// vendor profile before pushing. CINC's Swagger does NOT expose a
// "DefaultPaymentMethod" field directly; the UI shows "Check" by
// default and switches to ACH/Bank when Routing+Account are set. We
// derive the same way here.
// ─────────────────────────────────────────────────────────────────────
export interface CincVendorDetail {
  VendorId:           number
  VendorName:         string
  Dba?:               string  | null
  CheckName?:         string  | null
  Status?:            string  | null
  VendorType?:        string  | null
  TaxID?:             string  | null
  Email?:             string  | null
  Phone1?:            string  | null
  /** Net payment terms (days). CINC field name. */
  NetTerm?:           number  | null
  /** Auto-approval limit ($) above which the invoice needs manual
   *  approval in CINC. */
  AutoAprvLimit?:     number  | null
  /** Routing+Account+AccountType present means the vendor is set up
   *  for ACH/Bank Transfer in CINC. */
  Routing?:           string  | null
  Account?:           string  | null
  /** Bank account type (0=Checking, 1=Savings etc) — only meaningful
   *  when Routing+Account are set. */
  AccountType?:       number  | null
  /** True if CINC will consolidate multiple invoices onto one check. */
  ConsolodateChecks?: boolean | null
  Print1099Type?:     number  | null
  Ten99Box10?:        boolean | null
  /** DERIVED — not a real CINC field. We infer the vendor's default
   *  payment method by checking whether ACH banking is configured.
   *  This mirrors what CINC's vendor page shows in its "Default Pmt
   *  Method" field. */
  DefaultPmtMethod:   'ACH' | 'Check'
}

/** Fetch a single vendor's full detail by VendorId. Used by the
 *  invoice intake card to show Karen the CINC-side defaults
 *  (payment method, terms, banking) BEFORE she pushes — read-only,
 *  because payment-method changes require bank/ACH setup in CINC
 *  outside MAIA's scope. */
export async function getCincVendorDetail(vendorId: number): Promise<CincVendorDetail | null> {
  // The /management/1/vendors endpoint returns a list; with vendorId
  // it filters to that one. Some tenants return a single object,
  // some return a one-element array — handle both.
  const raw = await call<unknown>('/management/1/vendors', {
    method: 'GET',
    query:  { vendorId: String(vendorId) },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return null
    throw err
  })
  if (!raw) return null
  const v = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined
  if (!v || typeof v !== 'object') return null

  const routing = typeof v.Routing === 'string' ? v.Routing.trim() : ''
  const account = typeof v.Account === 'string' ? v.Account.trim() : ''
  const defaultPmtMethod: 'ACH' | 'Check' = (routing && account) ? 'ACH' : 'Check'

  return {
    VendorId:           Number(v.VendorId),
    VendorName:         String(v.VendorName ?? ''),
    Dba:                (v.Dba              as string  | undefined) ?? null,
    CheckName:          (v.CheckName        as string  | undefined) ?? null,
    Status:             (v.Status           as string  | undefined) ?? null,
    VendorType:         (v.VendorType       as string  | undefined) ?? null,
    TaxID:              (v.TaxID            as string  | undefined) ?? null,
    Email:              (v.Email            as string  | undefined) ?? null,
    Phone1:             (v.Phone1           as string  | undefined) ?? null,
    NetTerm:            typeof v.NetTerm       === 'number' ? v.NetTerm       : null,
    AutoAprvLimit:      typeof v.AutoAprvLimit === 'number' ? v.AutoAprvLimit : null,
    Routing:            routing || null,
    Account:            account || null,
    AccountType:        typeof v.AccountType   === 'number' ? v.AccountType   : null,
    ConsolodateChecks:  typeof v.ConsolodateChecks === 'boolean' ? v.ConsolodateChecks : null,
    Print1099Type:      typeof v.Print1099Type === 'number' ? v.Print1099Type : null,
    Ten99Box10:         typeof v.Ten99Box10    === 'boolean' ? v.Ten99Box10   : null,
    DefaultPmtMethod:   defaultPmtMethod,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Vendor compliance — insurance (COI) + licenses, read + push.
// Powers: the On-Hold pre-check (don't ask for docs already on file &
// valid), Paola's vendor-compliance audit, and the "Apply to CINC" COI/
// license push from a vendor upload.
// ─────────────────────────────────────────────────────────────────────
const asStr  = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const asNum  = (v: unknown): number | null => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : null))
function isoOrNull(v: unknown): string | null {
  const s = asStr(v); if (!s) return null
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
function notExpired(iso: string | null): boolean | null {
  if (!iso) return null
  return new Date(iso).getTime() >= Date.now()
}

export interface CincVendorInsurance {
  VendorInsuranceId: number | null
  insuranceType:     string | null   // e.g. "General Liability" — the read payload has no type ID, only this name
  policyNumber:      string | null
  carrier:           string | null
  expiration:        string | null   // ISO
  assocCode:         string | null
  isRequired:        boolean         // per-vendor, per-type — set via setVendorInsuranceRequired(). Confirmed live 2026-07-03: exists on every row but NOT actively maintained by staff (always false today) — don't treat false as a deliberate exemption unless it's been explicitly set through our own UI.
}
export async function getVendorInsurances(vendorId: number): Promise<CincVendorInsurance[]> {
  const raw = await call<unknown>('/management/1/vendors/vendorInsurance', {
    method: 'GET', query: { vendorId: String(vendorId), returnFiles: 'false' },
  }).catch(err => { if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return null; throw err })
  if (!raw) return []
  const rows = Array.isArray(raw) ? raw : ((raw as { VendorInsurances?: unknown[] }).VendorInsurances ?? [])
  return (rows as Record<string, unknown>[]).map(r => ({
    VendorInsuranceId: asNum(r.VendorInsuranceId),
    insuranceType:     asStr(r.InsuranceType),
    policyNumber:      asStr(r.AccountNumber),
    carrier:          asStr(r.InsuranceCarrier),
    expiration:       isoOrNull(r.Expiration),
    assocCode:        asStr(r.AssocCode),
    isRequired:       r.isRequired === true,
  }))
}

export interface CincVendorLicense {
  VendorLicenseId: number | null
  licenseType:     number | null
  licenseTypeName: string | null
  licenseNumber:   string | null
  expiration:      string | null   // ISO
}
export async function getVendorLicenses(vendorId: number): Promise<CincVendorLicense[]> {
  const raw = await call<unknown>('/management/1/vendors/vendorLicenses', {
    method: 'GET', query: { vendorId: String(vendorId) },
  }).catch(err => { if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return null; throw err })
  if (!raw) return []
  const rows = Array.isArray(raw) ? raw : ((raw as { VendorLicenses?: unknown[] }).VendorLicenses ?? [])
  return (rows as Record<string, unknown>[]).map(r => ({
    VendorLicenseId: asNum(r.VendorLicenseId),
    licenseType:     asNum(r.LicenseType),
    licenseTypeName: asStr(r.LicenseTypeName),
    licenseNumber:   asStr(r.LicenseNumber),
    expiration:      isoOrNull(r.LicenseExpiration),
  }))
}

let _insTypesCache: { types: { id: number; description: string }[]; expiresAt: number } | null = null
export async function listVendorInsuranceTypes(): Promise<{ id: number; description: string }[]> {
  if (_insTypesCache && _insTypesCache.expiresAt > Date.now()) return _insTypesCache.types
  const raw = await call<unknown>('/management/1/vendors/vendorInsuranceTypes', { method: 'GET', query: {} }).catch(() => [])
  const types = (Array.isArray(raw) ? raw : []).map(r => ({
    id: asNum((r as Record<string, unknown>).InsuranceID) ?? 0,
    description: asStr((r as Record<string, unknown>).InsuranceTypeDescription) ?? '',
  })).filter(t => t.id)
  _insTypesCache = { types, expiresAt: Date.now() + 60 * 60_000 }
  return types
}

/** Aggregate read of a vendor's compliance state from CINC — what's on
 *  file and whether it's still valid. `assocCode` (optional) narrows the
 *  COI check to the insurance row(s) covering that association. */
export interface VendorComplianceStatus {
  vendorId: number
  ach:      { onFile: boolean }
  w9:       { onFile: boolean }
  coi:      { onFile: boolean; expiration: string | null; valid: boolean | null; carrier: string | null }
  license:  { onFile: boolean; expiration: string | null; valid: boolean | null }
}
export async function getVendorComplianceStatus(vendorId: number, assocCode?: string | null): Promise<VendorComplianceStatus> {
  const [detail, insurances, licenses] = await Promise.all([
    getCincVendorDetail(vendorId).catch(() => null),
    getVendorInsurances(vendorId).catch(() => []),
    getVendorLicenses(vendorId).catch(() => []),
  ])
  // COI: prefer a row scoped to this association, else the latest-expiring.
  const relevant = assocCode
    ? insurances.filter(i => (i.assocCode ?? '').toUpperCase() === assocCode.toUpperCase())
    : insurances
  const pool = relevant.length ? relevant : insurances
  const coi = pool.slice().sort((a, b) => (b.expiration ?? '').localeCompare(a.expiration ?? ''))[0] ?? null
  const lic = licenses.slice().sort((a, b) => (b.expiration ?? '').localeCompare(a.expiration ?? ''))[0] ?? null
  return {
    vendorId,
    ach:     { onFile: !!(detail?.Routing && detail?.Account) },
    w9:      { onFile: !!(detail?.TaxID && String(detail.TaxID).trim()) },
    coi:     { onFile: !!coi, expiration: coi?.expiration ?? null, valid: notExpired(coi?.expiration ?? null), carrier: coi?.carrier ?? null },
    license: { onFile: !!lic, expiration: lic?.expiration ?? null, valid: notExpired(lic?.expiration ?? null) },
  }
}

/** Create a vendor license — POST /management/1/vendors/vendorLicense. */
export async function createVendorLicense(input: {
  vendorId: number; licenseType: number; licenseNumber?: string | null
  licenseExpiration?: string | null; licenseDescription?: string | null; isLicenseRequired?: boolean
}): Promise<void> {
  await call<unknown>('/management/1/vendors/vendorLicense', {
    method: 'POST',
    json: {
      VendorId:           input.vendorId,
      LicenseType:        input.licenseType,
      LicenseNumber:      input.licenseNumber ?? null,
      LicenseExpiration:  input.licenseExpiration ?? null,
      LicenseDescription: input.licenseDescription ?? null,
      IsLicenseRequired:  input.isLicenseRequired ?? true,
    },
  })
  invalidateVendorCache()
}

/** Push a COI (with the PDF as a byte array) into the vendor's CINC
 *  insurance record — PATCH /vendors/vendorInsuranceUpdateByteArray. */
export async function updateVendorInsuranceFile(input: {
  vendorId: number; insuranceTypeId: number; policyNumber?: string | null
  carrier?: string | null; expiration?: string | null; isRequired?: boolean
  fileBase64: string; fileName: string
}): Promise<void> {
  await call<unknown>('/management/1/vendors/vendorInsuranceUpdateByteArray', {
    method: 'PATCH',
    json: {
      VendorId:         input.vendorId,
      InsuranceId:      input.insuranceTypeId,
      AccountNumber:    input.policyNumber ?? null,
      isRequired:       input.isRequired ?? true,
      Expiration:       input.expiration ?? null,
      InsuranceCarrier: input.carrier ?? null,
      File:             input.fileBase64,
      FileName:         input.fileName,
    },
  })
}

/** Toggle whether a specific insurance type is required for a vendor —
 *  metadata-only PATCH (no file), confirmed live 2026-07-03 to update the
 *  existing VendorInsurance row in place (keyed by VendorId+InsuranceId,
 *  no duplicate created) rather than requiring a re-upload. Lets staff mark
 *  a vendor exempt from the COI-required invoice-push guard
 *  (app/api/admin/invoices/intake/[id]/push/route.ts) directly in CINC,
 *  since CINC's own isRequired flag isn't maintained by anyone otherwise. */
export async function setVendorInsuranceRequired(vendorId: number, insuranceTypeId: number, isRequired: boolean): Promise<void> {
  await call<unknown>('/management/1/vendors/vendorInsuranceUpdateByteArray', {
    method: 'PATCH',
    json: { VendorId: vendorId, InsuranceId: insuranceTypeId, isRequired },
  })
}

// ─────────────────────────────────────────────────────────────────────
// Vendor accounts — GET /management/1/vendor/{vendorId}/accounts.
// Per association, the vendor's CINC account number + the GL account it's
// normally booked to. Powers the invoice-intake "suggested GL line" (match
// AssocCode to the invoice's association). Returns [] on 4xx.
// ─────────────────────────────────────────────────────────────────────
export interface CincVendorAccount {
  assocCode:     string
  accountNumber: string | null
  glAccount:     string | null
}

export async function listVendorAccounts(vendorId: number): Promise<CincVendorAccount[]> {
  const data = await call<Array<Record<string, unknown>>>(
    `/management/1/vendor/${vendorId}/accounts`,
    { method: 'GET' },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as Array<Record<string, unknown>>
    }
    throw err
  })
  return (data ?? []).map(r => ({
    assocCode:     String(r.AssocCode ?? '').toUpperCase(),
    accountNumber: r.AccountNumber != null ? String(r.AccountNumber).trim() || null : null,
    glAccount:     r.GlAccount != null ? String(r.GlAccount).trim() || null : null,
  }))
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
    normalizeVendorName(v.Dba        ?? '') === target ||
    normalizeVendorName(v.CheckName  ?? '') === target,
  )
  if (exact) return exact

  const targetTokens = new Set(target.split(' ').filter(t => t.length >= 3))
  if (targetTokens.size === 0) return null

  let best: { vendor: CincVendorFull; score: number } | null = null
  for (const v of catalog) {
    const score = Math.max(
      scoreAgainstField(targetTokens, v.VendorName),
      scoreAgainstField(targetTokens, v.Dba),
      scoreAgainstField(targetTokens, v.CheckName),
    )
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { vendor: v, score }
    }
  }
  if (best) return best.vendor

  // Distinctive-token fallback. A short invoice name (e.g. just "Envera"
  // for vendor "Hidden Eyes LLC" DBA "Envera Systems") scores below 0.6
  // by token-overlap, yet is unambiguous. If exactly ONE vendor in the
  // whole catalog carries a long, distinctive target token (≥5 chars) in
  // its name / DBA / check name, match it. Uniqueness keeps this safe from
  // false positives — common words ("air", "pool") will hit many vendors
  // and bail out.
  const distinctive = [...targetTokens].filter(t => t.length >= 5)
  for (const token of distinctive) {
    const hits = catalog.filter(v =>
      fieldHasToken(v.VendorName, token) ||
      fieldHasToken(v.Dba, token) ||
      fieldHasToken(v.CheckName, token),
    )
    if (hits.length === 1) return hits[0]
  }
  return null
}

/** True if `token` appears as a whole normalized token in the field. */
function fieldHasToken(field: string | null | undefined, token: string): boolean {
  if (!field) return false
  return normalizeVendorName(field).split(' ').includes(token)
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
// Invoice statuses + pay-by types — small reference catalogs cached
// per process. Status is required on createInvoice; pay-by drives the
// dropdown so Karen only picks values CINC accepts for the assoc.
// ─────────────────────────────────────────────────────────────────────
// CINC's actual response shape (verified live) is:
//   { "InvoiceStatusId": -1, "InvoiceStatusDescription": "Pending Approval" }
// Note the casing: "Id" (not "ID") and "InvoiceStatusDescription". The
// other field names below are kept as defensive fallbacks in case CINC's
// inconsistent casing differs on another endpoint/tenant.
export interface CincInvoiceStatus {
  InvoiceStatusId?:          number
  InvoiceStatusDescription?: string | null
  StatusID?:                 number
  InvoiceStatusID?:          number
  StatusId?:                 number
  StatusDescription?:        string | null
  Description?:              string | null
  Name?:                     string | null
}
let _invoiceStatusesCache: CincInvoiceStatus[] | null = null

/** First id-ish field present on a status row (CINC uses InvoiceStatusId;
 *  ids can be negative, so check presence, not truthiness). */
function statusId(s: CincInvoiceStatus): number | null {
  for (const v of [s.InvoiceStatusId, s.StatusId, s.StatusID, s.InvoiceStatusID]) {
    if (typeof v === 'number') return v
  }
  return null
}
/** First name-ish field present on a status row. */
function statusDesc(s: CincInvoiceStatus): string {
  return (s.InvoiceStatusDescription ?? s.StatusDescription ?? s.Description ?? s.Name ?? '')
    .toUpperCase().replace(/\s+/g, ' ').trim()
}

export async function listInvoiceStatuses(): Promise<CincInvoiceStatus[]> {
  if (_invoiceStatusesCache) return _invoiceStatusesCache
  const data = await call<CincInvoiceStatus[]>('/management/associations/1/invoiceStatuses', { method: 'GET' })
    .catch(() => [] as CincInvoiceStatus[])
  _invoiceStatusesCache = data
  return data
}

/** Look up the numeric StatusID for a status by name (e.g. "PENDING
 *  APPROVAL"). Exact match first, then a contains-both-ways fallback so
 *  "PENDING APPROVAL" still resolves CINC's "Pending Approval". Returns
 *  null when not found so the caller can throw a useful error. */
export async function getInvoiceStatusIdByName(name: string): Promise<number | null> {
  const target = name.toUpperCase().replace(/\s+/g, ' ').trim()
  const statuses = await listInvoiceStatuses()
  for (const s of statuses) {
    if (statusDesc(s) === target) return statusId(s)
  }
  // Looser fallback — tolerate minor wording differences.
  for (const s of statuses) {
    const desc = statusDesc(s)
    if (desc && (desc.includes(target) || target.includes(desc))) return statusId(s)
  }
  return null
}

// Verified live (2026-05-29): /management/associations/1/payByTypes
// returns { PayTypeId, PayTypeDescription }. The older PascalCase guesses
// (PayByTypeID / PayByTypeName / Description / Name) never matched, so the
// payment-method dropdown came out blank. Real fields first; old names
// kept as defensive fallbacks.
export interface CincPayByType {
  PayTypeId?:          number | string | null
  PayTypeDescription?: string | null
  PayByTypeID?:        number | string | null
  PayByTypeName?:      string | null
  Description?:        string | null
  Name?:               string | null
  /** What the createInvoice body's PayByType field actually wants —
   *  the name string ("Check", "ACH"). */
  PayByType?:          string | null
}

const _payByCache = new Map<string, CincPayByType[]>()

/** GET /management/associations/1/payByTypes — valid pay-by options
 *  for an association. Cached per assoc for the container lifetime
 *  (rarely changes). */
export async function listPayByTypes(assocCode: string): Promise<CincPayByType[]> {
  const key = assocCode.toUpperCase()
  if (_payByCache.has(key)) return _payByCache.get(key)!
  const data = await call<CincPayByType[]>('/management/associations/1/payByTypes', {
    method: 'GET',
    query:  { assocCode: key },
  }).catch(() => [] as CincPayByType[])
  _payByCache.set(key, data)
  return data
}

// ─────────────────────────────────────────────────────────────────────
// Bank accounts — drives the "Pay from which bank account" picker in
// the invoice intake card. CINC's `Reserve` boolean is unreliable
// (returns false for accounts whose description clearly says "Reserve"),
// so we derive `kind` from the description text + Cash GL prefix as
// belt-and-suspenders.
// ─────────────────────────────────────────────────────────────────────

/** Raw CINC bankBalances shape, per probe on 2026-05-26. */
export interface CincBankAccount {
  BankAccountID?:       number | null
  AccountNum?:          string | null
  AccountDescription?:  string | null
  DepositoryAccount?:   boolean | null
  CincBalance?:         number | null
  BankBalance?:         number | null
  BankDate?:            string | null
  CashAccountNumber?:   string | null
  Reserve?:             boolean | null
}

export type BankAccountKind = 'operating' | 'reserve' | 'special' | 'other'

/** Normalised shape we feed the dropdown. */
export interface BankAccountOption {
  id:           number
  description:  string
  last4:        string | null
  cashGl:       string | null
  kind:         BankAccountKind
  bankBalance:  number | null
  cincBalance:  number | null
  /** True for accounts whose funds are contractually earmarked for a
   *  specific purpose (insurance claim payout, loan proceeds, etc.).
   *  Karen CAN pay from them, but only invoices tied to the specific
   *  covered work. Surfaced as a UI warning + audit note on push.
   *  Debt-service accounts are filtered out entirely at the API route
   *  level — those aren't available for AP at all. */
  restricted:   boolean
  /** Short human label for the restriction reason; only set when
   *  `restricted` is true. Examples: "Insurance Proceeds", "Loan Proceeds". */
  restrictionLabel: string | null
  /** True when this account is with SouthState Bank — the ONLY bank PMI has
   *  configured as an ACH-origination partner in CINC (confirmed 2026-07-06
   *  after an ACH payment failed from ESSI's "Ocean Bank Operating" account —
   *  CINC's bank-accounts API has no ACH-eligibility field of its own, so this
   *  is derived from the account description, same as `kind`). ACH invoices
   *  must only ever pay from an account where this is true. */
  achPartner: boolean
}

/** Description patterns for accounts holding restricted debt / escrow funds.
 *  These are never a valid source for ordinary AP invoice payments and must
 *  never shadow the real operating account. Shared by `deriveBankKind`
 *  (→ 'other') and the "Pay from" dropdown filter so the two never drift —
 *  previously the dropdown only excluded "debt service" by description while
 *  the classifier also flagged loan/mortgage/escrow, so those leaked into the
 *  payable list. */
const DEBT_ESCROW_RE = /\bdebt\b|loan|mortgage|escrow|\bclosing\b/i

/** True when an account's description marks it as restricted debt/escrow
 *  funds that must be kept out of the AP "Pay from" picker. */
export function isDebtOrEscrowAccount(description: string | null | undefined): boolean {
  return DEBT_ESCROW_RE.test(description ?? '')
}

function deriveBankKind(account: CincBankAccount): BankAccountKind {
  const desc = (account.AccountDescription ?? '').toLowerCase()
  if (/special\s*assess/.test(desc))     return 'special'
  if (/\breserve\b/.test(desc))          return 'reserve'
  // Debt service / loan / mortgage / escrow accounts are NOT operating, even
  // though their cash GL can share the 10- prefix (e.g. "Popular - Debt
  // Service" on 10-1010-00). Catch them before the prefix fallback so they
  // don't shadow the real operating account.
  if (DEBT_ESCROW_RE.test(desc)) return 'other'
  if (/\boperating\b|\boperations?\b/.test(desc)) return 'operating'
  // Cash GL prefix fallback per fund-accounting convention:
  //   10-xxxx = operating cash, 12-xxxx = reserve cash, 13-xxxx ≈ SA cash.
  const cashGl = account.CashAccountNumber ?? ''
  if (cashGl.startsWith('12-'))          return 'reserve'
  if (cashGl.startsWith('13-'))          return 'special'
  if (cashGl.startsWith('10-'))          return 'operating'
  return 'other'
}

/** Detect restricted-purpose accounts where funds are earmarked for a
 *  specific event (insurance claim, loan disbursement, etc.). Karen CAN
 *  pay from them but only for invoices tied to that purpose. Returns the
 *  human label of the restriction or null if the account is unrestricted.
 *
 *  Debt-service accounts aren't handled here — they're excluded entirely
 *  at the API-route level (see /api/admin/cinc/bank-accounts). */
function detectRestriction(account: CincBankAccount): string | null {
  const desc = account.AccountDescription ?? ''
  if (/insurance\s*proceeds/i.test(desc)) return 'Insurance Proceeds'
  if (/loan\s*proceeds/i.test(desc))      return 'Loan Proceeds'
  return null
}

/** SouthState is the only bank PMI has set up as an ACH-origination partner
 *  in CINC (confirmed 2026-07-06) — every other bank (Ocean Bank, Popular,
 *  Truist, City National, First Horizon, etc.) can hold association funds
 *  and pay by Check, but CANNOT process an ACH payment even though CINC's
 *  own API happily accepts the invoice at push time. */
export function isAchPartnerBank(description: string | null | undefined): boolean {
  return /\bssb\b|south\s*state|southstate/i.test(description ?? '')
}

function last4FromAccountNum(accountNum: string | null | undefined): string | null {
  if (!accountNum) return null
  const digits = accountNum.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

interface CachedBankAccounts { accounts: BankAccountOption[]; expiresAt: number }
const _bankAccountsCache = new Map<string, CachedBankAccounts>()
const BANK_ACCOUNTS_TTL_MS = 30 * 60_000  // 30 min — accounts change rarely

/** GET /management/1/banking/bankBalances — bank accounts for an
 *  association, with live balances. Cached per assoc for 30 min.
 *
 *  NOTE: CINC's documented `/management/associations/1/associationBankAccounts`
 *  endpoint 404s in our tenant; this one works and includes balances.
 *  See CINC_API.md.
 *
 *  The `kind` field is derived from AccountDescription (primary) with a
 *  Cash GL prefix fallback. CINC's `Reserve` boolean returns false even
 *  for actual reserve accounts — DO NOT rely on it. */
export async function listAssociationBankAccounts(
  assocCode: string,
  opts?:     { forceRefresh?: boolean },
): Promise<BankAccountOption[]> {
  const key = assocCode.toUpperCase()
  if (!opts?.forceRefresh) {
    const hit = _bankAccountsCache.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.accounts
  }

  const raw = await call<CincBankAccount[]>(
    '/management/1/banking/bankBalances',
    { method: 'GET', query: { assocCode: key } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincBankAccount[]
    }
    throw err
  })

  const accounts: BankAccountOption[] = []
  for (const r of raw) {
    if (r.BankAccountID == null) continue
    const restrictionLabel = detectRestriction(r)
    accounts.push({
      id:               r.BankAccountID,
      description:      (r.AccountDescription ?? '').trim() || `Account ${r.BankAccountID}`,
      last4:            last4FromAccountNum(r.AccountNum),
      cashGl:           r.CashAccountNumber ?? null,
      kind:             deriveBankKind(r),
      bankBalance:      typeof r.BankBalance === 'number' ? r.BankBalance : null,
      cincBalance:      typeof r.CincBalance === 'number' ? r.CincBalance : null,
      restricted:       restrictionLabel != null,
      restrictionLabel,
      achPartner:       isAchPartnerBank(r.AccountDescription),
    })
  }

  // Sort: operating first, then reserve, then special, then other; within a
  // kind, the ACH-partner (SouthState) account sorts first — otherwise a
  // purely-alphabetical tiebreak can put a non-ACH bank first (e.g. ESSI's
  // "Ocean Bank Operating" sorts before "SSB - Cash Operating" alphabetically,
  // which is exactly how an ACH invoice got auto-defaulted to a bank that
  // can't actually process ACH — see isAchPartnerBank).
  const order: Record<BankAccountKind, number> = { operating: 0, reserve: 1, special: 2, other: 3 }
  accounts.sort((a, b) =>
    order[a.kind] - order[b.kind]
    || Number(b.achPartner) - Number(a.achPartner)
    || a.description.localeCompare(b.description))

  _bankAccountsCache.set(key, { accounts, expiresAt: Date.now() + BANK_ACCOUNTS_TTL_MS })
  return accounts
}

export function invalidateBankAccountsCache(assocCode?: string): void {
  if (assocCode) _bankAccountsCache.delete(assocCode.toUpperCase())
  else           _bankAccountsCache.clear()
}

// ─────────────────────────────────────────────────────────────────────
// Invoice status + payment tracking — drives the /admin/reconciliation
// page and (eventually) a status sync cron that mirrors CINC's
// PENDING APPROVAL → READY FOR PAYMENT → PAID lifecycle into MAIA.
// ─────────────────────────────────────────────────────────────────────

/** Raw CINC OpenInvoicesVm per Swagger probe. Returned by
 *  GET /accounting/openInvoices. Notably does NOT include InvoiceID —
 *  to fetch payments you need the ID, which you can only get on
 *  invoices MAIA itself pushed (cinc_invoice_id is stored on the
 *  intake draft). */
export interface CincOpenInvoice {
  InvoiceDate?:    string | null
  DueDate?:        string | null
  InvoiceNumber?:  string | null
  InvoiceAmount?:  number | null
  InvoiceStatus?:  string | null
  InvoicePayTo?:   string | null
  AssocCode?:      string | null
  Balance?:        number | null
}

/** GET /management/1/accounting/openInvoices — open (unpaid) invoices,
 *  filterable by assoc. Used by the dashboard to show what's owed and
 *  by the reconciliation sync to know what hasn't been paid yet. */
export async function listOpenInvoices(opts?: { assocCode?: string }): Promise<CincOpenInvoice[]> {
  const query: Record<string, string> = {}
  if (opts?.assocCode) query.assocCode = opts.assocCode.toUpperCase()
  return await call<CincOpenInvoice[]>(
    '/management/1/accounting/openInvoices',
    { method: 'GET', query },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincOpenInvoice[]
    }
    throw err
  })
}

/** Resolve a CINC InvoiceID from an invoice NUMBER (+ optional assoc),
 *  via the invoice-search endpoint. Bank GL transactions only carry the
 *  invoice number as free text; the invoice-detail page needs the numeric
 *  ID, so the reconciliation "Invoice #" link uses this to look it up.
 *
 *  GET /management/associations/1/invoices requires `InvoiceDateFrom` +
 *  `InvoiceDateTo` (range ≤ 366 days) PLUS at least one other filter
 *  (`InvoiceNumber` here). Invoice date ≤ payment date, so we search a
 *  ~11-month window ENDING just after the (payment) date we're given.
 *  Returns null when nothing matches. Works for any status (incl. Paid).
 */
/** One row of the invoice-search list (per association, date range). Carries
 *  the payment method directly — no per-invoice fetch needed. */
export interface CincInvoiceListRow {
  InvoiceId?:              number | null
  InvoiceNumber?:          string | null
  InvoiceDate?:            string | null
  InvoiceStatus?:          string | null
  AssocCode?:              string | null
  VendorID?:               number | null
  Vendor?:                 string | null
  PayByType?:              string | null
  TotalInvoiceAmount?:     number | null
  BankAccountID?:          number | null
  BankAccountDescription?: string | null
}

/** GET /management/associations/1/invoices — list EVERY invoice for an
 *  association in a date range (≤366 days), each with its PayByType, VendorID,
 *  status, and bank account. The endpoint requires a date range PLUS one
 *  filter; `AssociationCode` returns the whole association (any status). Powers
 *  the 12-month payment-method backfill. Returns [] on 4xx. */
export async function listAssociationInvoices(opts: {
  assocCode: string
  fromDate:  string   // YYYY-MM-DD
  toDate:    string   // YYYY-MM-DD
}): Promise<CincInvoiceListRow[]> {
  const rows = await call<CincInvoiceListRow[]>('/management/associations/1/invoices', {
    method: 'GET',
    query:  { InvoiceDateFrom: opts.fromDate, InvoiceDateTo: opts.toDate, AssociationCode: opts.assocCode.toUpperCase() },
  }).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return [] as CincInvoiceListRow[]
    throw err
  })
  return Array.isArray(rows) ? rows : []
}

export async function findInvoiceIdByNumber(opts: {
  invoiceNumber: string
  assocCode?:    string | null
  aroundDate?:   string | null   // YYYY-MM-DD — the payment/effective date
}): Promise<number | null> {
  const num = (opts.invoiceNumber ?? '').trim()
  if (!num) return null
  const center = opts.aroundDate ? new Date(opts.aroundDate) : new Date()
  if (Number.isNaN(center.getTime())) return null
  const to   = new Date(center.getTime() + 10 * 86_400_000).toISOString().slice(0, 10)
  const from = new Date(center.getTime() - 330 * 86_400_000).toISOString().slice(0, 10)

  const rows = await call<Array<{ InvoiceId?: number; InvoiceID?: number; InvoiceNumber?: string; AssocCode?: string }>>(
    '/management/associations/1/invoices',
    { method: 'GET', query: { InvoiceDateFrom: from, InvoiceDateTo: to, InvoiceNumber: num } },
  ).catch(() => [] as Array<{ InvoiceId?: number; InvoiceID?: number; InvoiceNumber?: string; AssocCode?: string }>)

  const wantNum   = num.toLowerCase()
  const wantAssoc = opts.assocCode?.trim().toUpperCase() || null
  const list = Array.isArray(rows) ? rows : []
  const exact = list.filter(r => (r.InvoiceNumber ?? '').trim().toLowerCase() === wantNum)
  const pool  = exact.length ? exact : list
  const match = (wantAssoc ? pool.find(r => (r.AssocCode ?? '').toUpperCase() === wantAssoc) : null) ?? pool[0]
  return (match?.InvoiceId ?? match?.InvoiceID) ?? null
}

/** Read the payment method (PayByType) a vendor was actually paid by, from a
 *  PRIOR invoice in CINC — without us having pushed it. CINC's invoice search
 *  matches by EXACT invoice number, so this leans on the fact that utility
 *  invoice numbers embed the billing period. We build candidate numbers for
 *  recent prior months and search each; the search ROW carries PayByType, so
 *  no second fetch. Candidate prefixes come from:
 *    • the account number's last 6/7 digits (CINC's observed convention is
 *      "<tail>-<MMYYYY>", e.g. Xfinity "246788-062025" for account …0246788);
 *    • an already period-formatted invoice number ("<prefix><MMYYYY>").
 *  Best-effort → null when nothing matches. */
export async function lookupPriorInvoiceMethod(opts: {
  invoiceNumber?: string | null
  accountNumber?: string | null
  aroundDate?:    string | null   // the current bill's date (YYYY-MM-DD)
  vendorId?:      number | null    // only accept prior invoices for this vendor
  monthsBack?:    number          // how many prior months to try (default 6)
}): Promise<{ payByType: string; invoiceNumber: string; assocCode: string | null } | null> {
  const center = opts.aroundDate ? new Date(opts.aroundDate) : new Date()
  if (Number.isNaN(center.getTime())) return null
  type Row = { InvoiceNumber?: string | null; AssocCode?: string | null; PayByType?: string | null; VendorID?: number | null }
  const vid = typeof opts.vendorId === 'number' ? opts.vendorId : null

  const search = async (candidate: string, from: string, to: string) => {
    const rows = await call<Row[]>('/management/associations/1/invoices', {
      method: 'GET', query: { InvoiceDateFrom: from, InvoiceDateTo: to, InvoiceNumber: candidate },
    }).catch(() => [] as Row[])
    const hit = (Array.isArray(rows) ? rows : []).find(r =>
      (r.PayByType ?? '').trim() && (vid == null || r.VendorID === vid))
    return hit ? { payByType: (hit.PayByType ?? '').trim(), invoiceNumber: hit.InvoiceNumber ?? candidate, assocCode: hit.AssocCode ?? null } : null
  }

  // Strategy A — PERIOD-embedded numbers (utilities): <prefix>-<MMYYYY>, e.g.
  // Xfinity "246788-062025" off account …0246788. Build candidates for recent
  // prior months from the account tail and/or a period-formatted invoice #.
  const prefixes = new Set<string>()
  const acctDigits = (opts.accountNumber ?? '').replace(/\D/g, '')
  if (acctDigits.length >= 6) { prefixes.add(`${acctDigits.slice(-6)}-`); prefixes.add(`${acctDigits.slice(-7)}-`) }
  const im = /^(.*?)(?:0[1-9]|1[0-2])(\d{4})$/.exec((opts.invoiceNumber ?? '').replace(/\s+/g, ''))
  if (im && im[1]) prefixes.add(im[1])
  const monthsBack = Math.max(1, Math.min(opts.monthsBack ?? 6, 14))
  for (let i = 1; prefixes.size && i <= monthsBack; i++) {
    const d    = new Date(center.getFullYear(), center.getMonth() - i, 15)
    const mm   = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    const from = new Date(d.getTime() - 45 * 86_400_000).toISOString().slice(0, 10)
    const to   = new Date(d.getTime() + 45 * 86_400_000).toISOString().slice(0, 10)
    for (const prefix of prefixes) {
      const r = await search(`${prefix}${mm}${yyyy}`, from, to)
      if (r) return r
    }
  }

  // Strategy B — SEQUENTIAL numbers (e.g. PMI management fees "RVP-2933"): walk
  // back the preceding numbers in a wide recent window. Requires a vendorId
  // filter (or a distinctive lettered prefix) so we never read an unrelated
  // vendor's invoice that happens to share a numeric stem.
  const sm = /^(.*?[A-Za-z][-_ ]?)(\d{2,})$/.exec((opts.invoiceNumber ?? '').trim())
  if (sm && (vid != null || /[A-Za-z]{2,}/.test(sm[1]))) {
    const prefix = sm[1]
    const n      = parseInt(sm[2], 10)
    const width  = sm[2].length
    const from = new Date(center.getTime() - 150 * 86_400_000).toISOString().slice(0, 10)
    const to   = new Date(center.getTime() + 20 * 86_400_000).toISOString().slice(0, 10)
    for (let k = 1; k <= 6 && n - k > 0; k++) {
      const r = await search(`${prefix}${String(n - k).padStart(width, '0')}`, from, to)
      if (r) return r
    }
  }
  return null
}

/** Raw CINC InvoicePaymentVm per Swagger probe. Returned by
 *  GET /management/associations/1/invoicePayments?invoiceId=N. */
export interface CincInvoicePayment {
  TransDate?:      string | null  // ISO datetime, when payment hit the bank
  Description?:    string | null  // free-text (often includes check#, payee)
  CheckNo?:        string | null
  Amount?:         number | null
  ReconcileDate?:  string | null  // when CINC marks the payment reconciled
}

/** GET /management/associations/1/invoicePayments — all payments
 *  applied to a specific CINC invoice. Returns [] on a 4xx (interprets
 *  as "no payments found yet"). The endpoint does NOT return a payment
 *  ID, so callers dedupe on (invoiceId, amount, transDate). */
export async function listInvoicePayments(invoiceId: number): Promise<CincInvoicePayment[]> {
  return await call<CincInvoicePayment[]>(
    '/management/associations/1/invoicePayments',
    { method: 'GET', query: { invoiceId } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincInvoicePayment[]
    }
    throw err
  })
}

/** Raw CINC InvoiceHistoryVm per Swagger probe. Returned by
 *  GET /management/associations/1/invoiceHistory?invoiceId=N.
 *  One entry per audit-log event — status change, approval, void,
 *  edit, etc. — with the timestamp and CINC username who did it. */
export interface CincInvoiceHistoryEntry {
  Date?:     string | null  // ISO datetime
  Action?:   string | null  // "Invoice Created", "Status Changed", "Approved", "Voided", …
  Message?:  string | null  // free-text detail (often "From: <old> To: <new>")
  User?:     string | null  // CINC username (full name as shown in CINC)
}

/** GET /management/associations/1/invoiceHistory — full audit trail
 *  for a single CINC invoice. Includes who/when on every status
 *  change, approval, void, and edit. Returns [] on a 4xx (newly-
 *  created invoices may briefly have no history rows yet). */
export async function listInvoiceHistory(invoiceId: number): Promise<CincInvoiceHistoryEntry[]> {
  return await call<CincInvoiceHistoryEntry[]>(
    '/management/associations/1/invoiceHistory',
    { method: 'GET', query: { invoiceId } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincInvoiceHistoryEntry[]
    }
    throw err
  })
}

/** Raw CINC InvoiceExpenseItemVm per Swagger probe. One row per
 *  GL allocation on an invoice. */
export interface CincInvoiceExpenseItem {
  ID?:              number | null
  ChartId?:         number | null
  R?:               string | null
  GLAccount?:       string | null
  ItemDescription?: string | null
  Amount?:          number | null
  IsBankAccount?:   boolean | null
}

/** Raw CINC InvoiceAttachmentInfoVm — metadata only, the binary lives
 *  behind /document/{ImageID}. */
export interface CincInvoiceAttachmentInfo {
  ImageID?:  number | null
  FileName?: string | null
}

/** Raw CINC InvoiceVm per Swagger probe — the canonical "give me
 *  everything about this invoice" payload returned by
 *  GET /management/associations/1/invoice?invoiceId=N. Powers the
 *  /admin/invoices/cinc/[invoiceId] detail page. */
export interface CincInvoice {
  InvoiceID?:                  number | null
  AssocCode?:                  string | null
  AssociationName?:            string | null
  AssociationId?:              number | null
  InvoiceCreatedDate?:         string | null
  InvoiceCreatedById?:         number | null
  InvoiceCreatedByName?:       string | null
  TotalInvoiceAmount?:         number | null
  BankAccountID?:              number | null
  BankAccountDescription?:     string | null
  InvoiceStatus?:              string | null
  InvoiceStatusID?:            number | null
  VendorID?:                   number | null
  Vendor?:                     string | null
  VendorAddress1?:             string | null
  VendorAddress2?:             string | null
  VendorCity?:                 string | null
  VendorState?:                string | null
  VendorZip?:                  string | null
  PayByType?:                  string | null
  CheckMemo?:                  string | null
  InvoiceDate?:                string | null
  InvoiceNumber?:              string | null
  VendorAccountNumber?:        string | null
  InvoiceDueDate?:             string | null
  WorkOrderNumber?:            number | null
  NoteDescription?:            string | null
  ExpenseItems?:               CincInvoiceExpenseItem[] | null
  AttachmentInfo?:             CincInvoiceAttachmentInfo[] | null
}

/** GET /management/associations/1/invoice — fetch one invoice with
 *  every field CINC stores on it (status, vendor, bank, pay-by type,
 *  expense items, attachment metadata). Returns null on 4xx (invoice
 *  not found / deleted / wrong assoc). */
export async function getCincInvoice(invoiceId: number): Promise<CincInvoice | null> {
  return await call<CincInvoice>(
    '/management/associations/1/invoice',
    { method: 'GET', query: { invoiceId } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return null
    }
    throw err
  })
}

/** Raw CINC InvoiceNoteVm — per Swagger /accounting/invoiceNotes
 *  doesn't have a documented response model, so this is derived from
 *  observed payloads. Fields are optional to tolerate schema drift. */
export interface CincInvoiceNote {
  NoteID?:       number | null
  InvoiceID?:    number | null
  NoteDate?:     string | null
  NoteContent?:  string | null
  DeletedFlag?:  boolean | null
  CreatedBy?:    string | null
}

/** GET /management/1/accounting/invoiceNotes/{invoiceID} — fetch the
 *  notes thread on an invoice. Optionally include deleted notes for
 *  audit views. */
export async function listInvoiceNotes(
  invoiceId:        number,
  opts?:            { includeDeleted?: boolean },
): Promise<CincInvoiceNote[]> {
  const query: Record<string, string> = {}
  if (opts?.includeDeleted) query.includeDeleted = 'true'
  return await call<CincInvoiceNote[]>(
    `/management/1/accounting/invoiceNotes/${invoiceId}`,
    { method: 'GET', query },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincInvoiceNote[]
    }
    throw err
  })
}

/** Raw CINC GlTransactionByDate VM per Swagger probe. Returned by
 *  GET /accounting/glTransactionsByDateAndAssocCode. Every transaction
 *  hitting the specified GL account in the date range — for a Cash GL
 *  (e.g. 10-1000-00 = operating cash) this is effectively the bank
 *  ledger as CINC sees it: assessment income deposits, vendor invoice
 *  payments, transfers, fees. Each entry has either a non-zero credit
 *  OR debit amount, never both. */
export interface CincGlTransaction {
  GLTransID?:        number | null   // unique CINC transaction id — use as dedupe key
  AccountNumber?:    string | null   // e.g. "10-1000-00"
  AssocId?:          number | null
  AssocCode?:        string | null
  CreditAmount?:     number | null   // money OUT of the account (for cash)
  DebitAmount?:      number | null   // money IN to the account (for cash)
  Description?:      string | null   // vendor name, check#, payor — free text
  TransactionDate?:  string | null   // ISO datetime when the transaction occurred
  CreatedDate?:      string | null
  PostedDate?:       string | null
  ActualPostedDate?: string | null
}

/** GET /management/1/accounting/glTransactionsByDateAndAssocCode —
 *  every GL transaction for (assoc, account, date range). Filtered to
 *  a single account number (typically a bank's Cash GL) gives the full
 *  bank activity ledger from CINC. Returns [] on 4xx. */
export async function listGlTransactionsByDate(opts: {
  assocCode:     string
  fromDate:      string  // ISO date 'YYYY-MM-DD'
  toDate:        string
  /** Omit to return transactions across ALL accounts (e.g. to find the
   *  expense GL an invoice was booked to, which lives on a different
   *  account than the cash credit). */
  accountNumber?: string  // e.g. '10-1000-00'
}): Promise<CincGlTransaction[]> {
  return await call<CincGlTransaction[]>(
    '/management/1/accounting/glTransactionsByDateAndAssocCode',
    {
      method: 'GET',
      query:  {
        assocCode:     opts.assocCode.toUpperCase(),
        fromDate:      opts.fromDate,
        toDate:        opts.toDate,
        ...(opts.accountNumber ? { accountNumber: opts.accountNumber } : {}),
      },
    },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincGlTransaction[]
    }
    throw err
  })
}

/** A homeowner ledger line as CINC returns it (confirmed against prod via the
 *  /api/admin/cinc/owner-ledger probe). `Debit` = a charge, `Credit` = a
 *  payment, `RunningBalance` = balance after the line. `Assessment` is the
 *  richest description; `Date` is an ISO datetime. NOTE: CINC ignores the date
 *  query params and returns the full schedule (incl. future-dated charges), so
 *  callers filter the window client-side (see lib/owner-ledger). */
export interface CincHomeownerTransaction {
  PropertyHoid?:               string | null
  AssocCode?:                  string | null
  Date?:                       string | null   // ISO datetime, e.g. "2026-01-01T00:00:00"
  Credit?:                     number | null   // payment (money in)
  Debit?:                      number | null   // charge (money out)
  Description?:                string | null
  Assessment?:                 string | null   // richest line description
  TransactionTypeID?:          number | null
  TransactionTypeDescription?: string | null
  RunningBalance?:             number | null
  ReferenceNumber?:            string | null
  [key: string]: unknown
}

/** GET /management/1/associations/{assocCode}/homeowners/{hoId}/homeownertransaction
 *  — one homeowner's ledger (charges + payments). `hoId` = owners.account_number
 *  (CINC PropertyHOID, e.g. "ISLAND4"). Returns the full schedule; filter the
 *  date window client-side. Returns [] on 4xx. */
export async function getHomeownerLedger(opts: {
  assocCode: string
  hoId:      string
  fromDate:  string   // 'YYYY-MM-DD'
  toDate:    string
}): Promise<CincHomeownerTransaction[]> {
  const assoc = opts.assocCode.toUpperCase()
  return await call<CincHomeownerTransaction[]>(
    `/management/1/associations/${encodeURIComponent(assoc)}/homeowners/${encodeURIComponent(opts.hoId)}/homeownertransaction`,
    { method: 'GET', query: { fromDate: opts.fromDate, toDate: opts.toDate } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) {
      return [] as CincHomeownerTransaction[]
    }
    throw err
  })
}

/** GET /management/1/flaggedCollections/homeownersInCollections?assocCode=
 *  — homeowners flagged into the collections workflow for an association.
 *  Shape unverified against prod; probe before relying on field names.
 *  Returns [] on 4xx. */
export async function listHomeownersInCollections(assocCode: string): Promise<Record<string, unknown>[]> {
  return await call<Record<string, unknown>[]>(
    '/management/1/flaggedCollections/homeownersInCollections',
    { method: 'GET', query: { assocCode: assocCode.toUpperCase() } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return []
    throw err
  })
}

/** GET /management/1/accounting/legalStatusByAssociation?assocCode=
 *  — per-homeowner legal status (collections / legal step) for an association.
 *  Shape unverified against prod. Returns [] on 4xx. */
export async function listLegalStatusByAssociation(assocCode: string): Promise<Record<string, unknown>[]> {
  return await call<Record<string, unknown>[]>(
    '/management/1/accounting/legalStatusByAssociation',
    { method: 'GET', query: { assocCode: assocCode.toUpperCase() } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return []
    throw err
  })
}

/** GET /management/1/homeowners/getHomeownerDetailsForIVRPayment?hoId=
 *  — the REAL per-homeowner "Block Payments" status. CONFIRMED against prod
 *  2026-07-03 via a live self-block test (toggling "Block Payments" on the
 *  Homeowner record in CINC's UI): returns `BlockPaymentsFlag` and
 *  `IsHomeownerOrAssociationBlocked` (the latter also covers the whole
 *  association being blocked, not just this homeowner — prefer it).
 *  `hoId` = owners.account_number = CINC PropertyHOID (e.g. "ISLAND4").
 *  Returns null if the homeowner isn't found (never throws for a 4xx). */
export async function getHomeownerPaymentBlockStatus(hoId: string): Promise<{ blocked: boolean; balance: number | null } | null> {
  const rows = await call<Array<{ BlockPaymentsFlag?: boolean; IsHomeownerOrAssociationBlocked?: boolean; Balance?: number }>>(
    '/management/1/homeowners/getHomeownerDetailsForIVRPayment',
    { method: 'GET', query: { hoId } },
  ).catch(err => {
    if (err instanceof CincApiError && err.status && err.status >= 400 && err.status < 500) return []
    throw err
  })
  const row = rows[0]
  if (!row) return null
  return {
    blocked: !!(row.IsHomeownerOrAssociationBlocked ?? row.BlockPaymentsFlag),
    balance: typeof row.Balance === 'number' ? row.Balance : null,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Invoice CRUD — used by the intake-queue push flow
//
// All field names below follow CINC's actual Swagger shape (PascalCase
// with capital ID, AssociationCode as a STRING — not the numeric
// AssocId we look up for work orders). Earlier Phase-1 code guessed
// the shape from prose docs and got every name wrong; this is the fix.
// ─────────────────────────────────────────────────────────────────────
export interface CincInvoiceMatch {
  InvoiceID:           number
  InvoiceNumber?:      string | null
  InvoiceDate?:        string | null
  TotalInvoiceAmount?: number | null
  VendorID?:           number | null
  AssocCode?:          string | null
  InvoiceStatus?:      string | null
  CheckNo?:            number | null
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
      vendorID:      opts.vendorId,       // CINC uses capital D
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
  associationCode:      string
  vendorId:             number
  invoiceNumber:        string
  invoiceDate:          string       // ISO date (YYYY-MM-DD)
  amount:               number
  dueDate?:             string | null
  noteDescription?:     string | null    // appears as "observations" in CINC UI
  memo?:                string | null    // prints on check
  payByType?:           string | null    // e.g. "Check", "ACH" — from listPayByTypes
  workOrderNumber?:     number | null
  vendorAccountNumber?: string | null
  payFromBankAccountId?: number | null
  /** Status to create the invoice in. Defaults to PENDING APPROVAL —
   *  the only status appropriate for board-approval-required invoices,
   *  per CINC's create-time restriction (PAID / VOID / READY FOR
   *  PAYMENT are explicitly disallowed on create). */
  statusName?:          string
}

export interface CreateInvoiceResult {
  invoiceId: number
}

/** POST /accounting/invoice — creates the invoice header. Caller
 *  follows up with attachInvoicePdf to upload the file. Status defaults
 *  to PENDING APPROVAL so the board can approve in WebAxis. */
export async function createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const statusName = input.statusName ?? 'PENDING APPROVAL'
  const statusId   = await getInvoiceStatusIdByName(statusName)
  if (statusId == null) {
    throw new CincApiError(
      `Cannot resolve CINC StatusID for "${statusName}". ` +
      `Check /management/associations/1/invoiceStatuses returns this name.`,
    )
  }

  const body: Record<string, unknown> = {
    AssociationCode:      input.associationCode.toUpperCase(),
    VendorID:             input.vendorId,
    TotalInvoiceAmount:   input.amount,
    Date:                 input.invoiceDate,
    DueDate:              input.dueDate ?? input.invoiceDate,
    VendorAccountNumber:  input.vendorAccountNumber ?? '',
    StatusID:             statusId,
    InvoiceNumber:        input.invoiceNumber,
    NoteDescription:      (input.noteDescription ?? '').slice(0, 1000),
    PayFromBankAccountID: input.payFromBankAccountId ?? 0,
    Memo:                 (input.memo ?? '').slice(0, 1000),
  }
  // Only send PayByType when staff explicitly picked one. OMITTING it (vs
  // sending an empty string) makes CINC apply the VENDOR's saved Default Pmt
  // Method — the correct method per vendor — instead of forcing a guess.
  if (typeof input.payByType === 'string' && input.payByType.trim()) {
    body.PayByType = input.payByType.trim()
  }
  // Only send WorkOrderNumber when this invoice is actually linked to a
  // work order. CINC rejects a 0/blank value with 400 "Invalid Work Order
  // Number" — a standalone invoice must OMIT the field entirely.
  if (typeof input.workOrderNumber === 'number' && input.workOrderNumber > 0) {
    body.WorkOrderNumber = input.workOrderNumber
  }
  const result = await call<{ InvoiceID?: number; InvoiceId?: number; Invoice?: { InvoiceID?: number } }>(
    '/management/1/accounting/invoice',
    { method: 'POST', json: body },
  )
  const invoiceId = result.InvoiceID ?? result.Invoice?.InvoiceID ?? result.InvoiceId
  if (!invoiceId) throw new CincApiError('createInvoice succeeded but response had no InvoiceID')
  return { invoiceId }
}

/** POST /accounting/approvedInvoices — create an invoice DIRECTLY in
 *  "Ready for Payment" status (skips the PENDING APPROVAL → approve step).
 *  Used when Jonathan marks a MAIA-scheduled draft paid: the draft isn't in
 *  CINC's payment queue yet, so we post it here so CINC will actually pay
 *  it. (CINC has no "mark Paid" write — Paid is set by CINC's payment run;
 *  this is the furthest forward MAIA can move an invoice via the API.)
 *
 *  Body shape per CINC Swagger: AssocCode + VendorID + InvoiceNumber +
 *  InvoiceDate + TotalInvoiceAmount + ApprovalDate + PayFromBankAccountID +
 *  PayByType + ExpenseItems[{ GLNumber, Description, Amount }]. Returns the
 *  new CINC InvoiceID. Best-effort: throws CincApiError on a non-2xx so the
 *  caller can still reconcile locally and surface the failure. */
export interface ApprovedInvoiceInput {
  associationCode:       string
  vendorId:              number
  invoiceNumber:         string
  invoiceDate:           string   // YYYY-MM-DD
  amount:                number
  approvalDate?:         string | null   // defaults to invoiceDate
  payFromBankAccountId?: number | null
  payByType?:            string | null
  checkMemo?:            string | null
  expenseItems?:         CreateExpenseItemInput[]
}

export async function postApprovedInvoice(input: ApprovedInvoiceInput): Promise<{ invoiceId: number }> {
  const body: Record<string, unknown> = {
    AssocCode:            input.associationCode.toUpperCase(),
    VendorID:             input.vendorId,
    InvoiceNumber:        input.invoiceNumber,
    InvoiceDate:          input.invoiceDate,
    TotalInvoiceAmount:   input.amount,
    ApprovalDate:         input.approvalDate ?? input.invoiceDate,
    PayFromBankAccountID: input.payFromBankAccountId ?? 0,
    CheckMemo:            (input.checkMemo ?? '').slice(0, 1000),
    PayByType:            input.payByType ?? '',
    ChargeBack:           false,
    ExpenseItems:         (input.expenseItems ?? []).map(it => ({
      GLNumber:    it.glNumber,
      Description: it.description.slice(0, 100),
      Amount:      it.amount,
    })),
  }
  const result = await call<Array<{ InvoiceID?: number; Invoice?: { InvoiceID?: number } }> | { InvoiceID?: number; Invoice?: { InvoiceID?: number } }>(
    '/management/1/accounting/approvedInvoices',
    { method: 'POST', json: body },
  )
  const row      = Array.isArray(result) ? result[0] : result
  const invoiceId = row?.InvoiceID ?? row?.Invoice?.InvoiceID
  if (!invoiceId) throw new CincApiError('postApprovedInvoice succeeded but response had no InvoiceID')
  return { invoiceId }
}

/** POST /accounting/expenseItems — record the GL allocation lines for
 *  a CINC invoice. Called right after createInvoice so the GL pick
 *  Karen made in MAIA actually lands as an expense item in CINC
 *  (without this, the invoice header exists but has no GL line —
 *  someone has to add it manually in CINC). The endpoint takes the
 *  formatted GL number (e.g. "50-5000-00"), NOT the ChartID — caller
 *  is responsible for resolving the ChartID → GlNumber via the budget
 *  helper. Returns the IDs of the created expense items.
 *
 *  Description is hard-capped at 100 chars per CINC's Swagger contract.
 *  Most CINC GL descriptions are well under that. */
export interface CreateExpenseItemInput {
  glNumber:    string
  description: string
  amount:      number
}

export async function createInvoiceExpenseItems(opts: {
  invoiceId: number
  items:     CreateExpenseItemInput[]
}): Promise<number[]> {
  if (opts.items.length === 0) {
    throw new CincApiError('createInvoiceExpenseItems requires at least one item')
  }
  const result = await call<number[] | { ExpenseItemIDs?: number[] }>(
    '/management/1/accounting/expenseItems',
    {
      method: 'POST',
      json:   {
        InvoiceID:    opts.invoiceId,
        ExpenseItems: opts.items.map(i => ({
          GlNumber:    i.glNumber,
          Description: (i.description ?? '').slice(0, 100),
          Amount:      i.amount,
        })),
      },
    },
  )
  // CINC's "returns the ID numbers" doc is ambiguous about envelope —
  // accept both bare array and wrapped object.
  if (Array.isArray(result)) return result
  return result?.ExpenseItemIDs ?? []
}

/** DELETE /accounting/expenseItems — remove expense lines from an invoice.
 *  createInvoice auto-creates a blank-GL placeholder line equal to the
 *  invoice total; once we POST the real GL line, that blank one must be
 *  removed or the invoice doubles. The request model (per CINC Swagger)
 *  is `{ InvoiceId, ExpenseItems: [<id>] }` — note the lowercase-d
 *  `InvoiceId` and that ExpenseItems is a BARE ARRAY OF NUMBERS (the
 *  expense item IDs from the GET / POST response), not objects.
 *  Best-effort: caller should swallow failures and warn. */
export async function deleteInvoiceExpenseItems(opts: {
  invoiceId:       number
  expenseItemIds:  number[]
}): Promise<void> {
  if (opts.expenseItemIds.length === 0) return
  await call<unknown>('/management/1/accounting/expenseItems', {
    method: 'DELETE',
    json:   { InvoiceId: opts.invoiceId, ExpenseItems: opts.expenseItemIds },
  })
}

/** POST /accounting/invoiceNotes — add a note (audit trail) to an
 *  existing invoice. Used right after every MAIA push to record
 *  provenance ("Auto-ingested from <sender> on <date>") so anyone
 *  viewing the invoice in CINC sees where it came from. Best-effort:
 *  callers should swallow failures. */
export async function createInvoiceNote(opts: {
  invoiceId: number
  content:   string
}): Promise<void> {
  await call<number[]>('/management/1/accounting/invoiceNotes', {
    method: 'POST',
    json:   {
      InvoiceID:   opts.invoiceId,
      NoteDate:    new Date().toISOString(),
      NoteContent: opts.content.slice(0, 2000),
      DeletedFlag: false,
    },
  })
}

/** PUT /accounting/approveInvoice — moves an EXISTING invoice from
 *  PENDING APPROVAL to CINC's approved/Ready for Payment status, so
 *  board members no longer need to separately approve it in WebAxis.
 *
 *  ⚠ UNVERIFIED: CINC_API.md lists this endpoint but no request/response
 *  shape was ever documented or exercised in this codebase — postApprovedInvoice
 *  (a different endpoint, for creating a NEW invoice directly in Ready for
 *  Payment) was previously "the furthest forward MAIA can move an invoice
 *  via the API." Body shape below follows CINC's InvoiceID + ApprovalDate
 *  convention used by the sibling approvedInvoices/invoiceNotes endpoints,
 *  but has NOT been confirmed against a real invoice. Smoke-test on one
 *  real invoice before relying on this broadly. Best-effort: callers
 *  should treat failure as "still needs WebAxis approval," not fatal. */
export async function approveInvoice(opts: {
  invoiceId:     number
  approvalDate?: string | null
}): Promise<void> {
  await call<unknown>('/management/1/accounting/approveInvoice', {
    method: 'PUT',
    json:   {
      InvoiceID:    opts.invoiceId,
      ApprovalDate: opts.approvalDate ?? new Date().toISOString().slice(0, 10),
    },
  })
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

/** PUT /associations/InvoiceAttachmentsBase64 — attach a single PDF/image
 *  to a CINC invoice. CINC's hard limit is 25 MB pre-conversion.
 *  Body model is { InvoiceID, FileName, File } — the base64 goes in the
 *  `File` field. CINC rejects `FileContent` with 400 "Invalid Model"
 *  (verified live against invoice 16236: only `File` returns 200). */
export async function attachInvoicePdf(opts: {
  invoiceId: number
  pdfBase64: string
  filename:  string
}): Promise<{ imageId: number }> {
  const result = await call<{ ImageID?: number; ImageId?: number }>(
    '/management/1/associations/InvoiceAttachmentsBase64',
    {
      method: 'PUT',
      json:   { InvoiceID: opts.invoiceId, FileName: opts.filename, File: opts.pdfBase64 },
    },
  )
  const imageId = result.ImageID ?? result.ImageId
  if (!imageId) throw new CincApiError('attachInvoicePdf succeeded but response had no ImageID')
  return { imageId }
}

// ─────────────────────────────────────────────────────────────────────
// Push photos/files INTO a CINC work order (MAIA → CINC).
//
// Counterpart to listWorkOrderAttachments (the CINC → MAIA mirror). CINC
// renames files on upload (file<hash>.png) and returns no attachment id,
// so we can't dedupe against what's already there — the caller guards
// double-pushes with the work_order_attachments.cinc_pushed_at stamp.
//
// POST /management/1/workOrderAttachment  (singular — the plural is GET).
//   - workOrderId is a QUERY param.
//   - Body is an ARRAY (batch): [{ fileName, file }], file = base64 bytes,
//     ≤ 25 MB each (our stored photos are already ≤ 4 MB post-compression).
// ─────────────────────────────────────────────────────────────────────
export async function pushWorkOrderAttachments(
  workOrderId: number,
  files: Array<{ fileName: string; file: string /* base64 */ }>,
): Promise<void> {
  if (files.length === 0) return
  await call<unknown>('/management/1/workOrderAttachment', {
    method: 'POST',
    query:  { workOrderId },
    json:   files,
  })
}
