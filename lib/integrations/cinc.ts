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
interface WorkOrderStatus { WorkOrderStatusId: number; WorkOrderStatusDescription: string }

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
    DueDate:          input.dueDate         ?? current.DueDate        ?? null,
    FollowupDate:     current.FollowUpDate  ?? null,
    PropertyId:       current.PropertyId    ?? null,
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
