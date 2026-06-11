// =====================================================================
// lib/integrations/cinc-inbound.ts
//
// Phase B-1 / B-2 — pull work orders, status changes, and conversation
// notes FROM CINC into our tickets / ticket_messages tables.
//
// CINC has no "modifiedAfter" filter; updates are detected by re-fetching
// each open work order by ID. The cron therefore runs two passes:
//
//   1) Discovery: GET /workOrders?createdFromDate=<cursor>
//      → upsert NEW work orders into tickets
//   2) Refresh: for each ticket with cinc_workorder_id and status NOT
//      closed, GET /workOrders?workOrderId=X → diff status + notes
//
// Both passes are idempotent: ticket_messages dedupes by
// (channel='internal', external_id=NoteId), tickets dedupes by
// cinc_workorder_id.
// =====================================================================

import { supabaseAdmin }                from '@/lib/supabase-admin'
import * as cinc                        from '@/lib/integrations/cinc'
import type { CincWorkOrder, CincNote } from '@/lib/integrations/cinc'

const CINC_CHANNEL = 'internal' // ticket_messages channel CHECK doesn't include 'cinc'
const CINC_TENANT_TZ = 'America/New_York'

/** Parse a CINC timestamp.
 *
 *  CINC's API returns naive wall-clock strings in the tenant's local
 *  timezone (Eastern for PMITFP). JavaScript Dates parse those as UTC
 *  by default — so a note CINC labeled "3:57 PM Eastern" was landing
 *  in our DB as 3:57 PM UTC, displayed back to staff as "11:57 AM ET"
 *  (4 hours earlier than reality).
 *
 *  Fix: if the string is naive, treat the wall-clock parts as Eastern
 *  and shift to true UTC. If the string already has a timezone marker
 *  (Z or ±HH:MM), trust it as-is. */
function parseCincTimestamp(raw: string | undefined | null): string | null {
  if (!raw) return null
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  const iso   = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const asUtc = new Date(iso + 'Z')
  if (isNaN(asUtc.getTime())) return null

  // Compute Eastern's UTC offset at that wall-clock moment (handles DST).
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: CINC_TENANT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(asUtc).map(p => [p.type, p.value]))
  const easternWallAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  )
  const offsetMs = easternWallAsUtc - asUtc.getTime()  // negative for EDT/EST
  return new Date(asUtc.getTime() - offsetMs).toISOString()
}

/** CINC status string → our TicketStatus. Best-effort string match;
 *  unknown statuses default to 'open' so we don't silently drop them. */
function mapCincStatus(cincStatus: string | undefined): 'open' | 'pending' | 'waiting_external' | 'resolved' | 'closed' {
  const s = (cincStatus ?? '').toLowerCase()
  if (s.includes('closed')   || s.includes('cancel'))     return 'closed'
  if (s.includes('complete') || s.includes('resolved'))   return 'resolved'
  if (s.includes('pending')  || s.includes('hold'))       return 'pending'
  if (s.includes('vendor')   || s.includes('waiting'))    return 'waiting_external'
  return 'open'
}

interface UpsertCounts {
  ticketsInserted:  number
  ticketsUpdated:   number
  notesInserted:    number
}

/** Upsert a single CINC work order into tickets + ticket_messages.
 *  Returns counts so the cron can report aggregate results. */
async function upsertWorkOrder(wo: CincWorkOrder): Promise<UpsertCounts> {
  const counts: UpsertCounts = { ticketsInserted: 0, ticketsUpdated: 0, notesInserted: 0 }

  const cincWoIdStr = String(wo.WorkOrderId)
  const contact     = wo.Contacts?.[0]
  const description = wo.Description ?? ''
  const subject     = description.split('\n')[0]?.slice(0, 200) ?? `CINC WO ${cincWoIdStr}`
  const status      = mapCincStatus(wo.WorkOrderStatus)

  // Find existing ticket by cinc_workorder_id.
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('tickets')
    .select('id, status, subject, summary, association_code, work_order_type_id, work_order_type_name')
    .eq('cinc_workorder_id', cincWoIdStr)
    .maybeSingle()
  if (findErr) throw new Error(`tickets lookup failed for cinc_workorder_id=${cincWoIdStr}: ${findErr.message}`)

  let ticketId: number
  if (!existing) {
    // Insert new ticket.
    const insertRow = {
      type:                 'work_order',
      status,
      priority:             'normal',
      channel_origin:       CINC_CHANNEL,
      association_code:     wo.AssocCode ?? null,
      contact_name:         contact?.ContactName  ?? null,
      contact_email:        contact?.ContactEmail?.toLowerCase() ?? null,
      contact_phone:        contact?.ContactPhone ?? null,
      subject,
      summary:              description.slice(0, 500),
      due_at:               parseCincTimestamp(wo.DueDate),
      cinc_workorder_id:    cincWoIdStr,
      work_order_type_id:   wo.WorkOrderTypId ?? null,
      work_order_type_name: wo.WorkOrderType  ?? null,
      sync_status:          { cinc: { ok: true, last_synced_at: new Date().toISOString(), source: 'inbound' } },
    }
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('tickets')
      .insert(insertRow)
      .select('id')
      .single()
    if (insertErr || !inserted) throw new Error(`ticket insert failed for cinc_workorder_id=${cincWoIdStr}: ${insertErr?.message}`)
    ticketId = inserted.id
    counts.ticketsInserted++
  } else {
    ticketId = existing.id
    // Update if status / subject / summary changed on the CINC side.
    // We deliberately DON'T sync work_order_type_id / _name back from
    // CINC on refresh: MAIA is the source of truth for the type now
    // (staff edits flow out via the integration_outbox 'update_details'
    // handler, which PATCHes /workOrderDetails). Syncing back would
    // race with in-flight outbound updates and stomp staff edits if
    // the outbox row hadn't drained yet.
    const patch: Record<string, unknown> = {}
    // Status: same source-of-truth reasoning as work_order_type above — never
    // let an inbound refresh DOWNGRADE a MAIA-resolved/closed WO back to a
    // non-terminal CINC status. CINC routinely lags (staff resolve it here and
    // the outbox is still draining), and stomping it reverted resolved WOs to
    // pending. CINC may still ADVANCE status (e.g. → resolved), just not regress.
    const terminal = (s: string) => s === 'resolved' || s === 'closed'
    if (existing.status !== status && !(terminal(existing.status) && !terminal(status))) patch.status = status
    if ((existing.subject ?? '')      !== subject)                                  patch.subject              = subject
    if ((existing.summary ?? '')      !== description.slice(0, 500))                patch.summary              = description.slice(0, 500)
    if (Object.keys(patch).length > 0) {
      patch.sync_status = { cinc: { ok: true, last_synced_at: new Date().toISOString(), source: 'inbound' } }
      const { error: updateErr } = await supabaseAdmin
        .from('tickets')
        .update(patch)
        .eq('id', ticketId)
      if (updateErr) throw new Error(`ticket update failed for id=${ticketId}: ${updateErr.message}`)
      counts.ticketsUpdated++
    }
  }

  // Mirror the CINC-side WO metadata into work_order_details. Idempotent
  // upsert keyed on ticket_id (which is the PK). Safe to re-run for
  // backfill.
  await upsertWorkOrderDetails(ticketId, wo)

  // Sync notes — idempotent via (channel, external_id) unique index.
  for (const note of (wo.Notes ?? [])) {
    counts.notesInserted += await insertNoteIfNew(ticketId, note)
  }

  return counts
}

/** Mirror CINC WorkOrder fields into work_order_details. Creates the
 *  row on first call, updates it on subsequent calls. Designed so the
 *  cron's refresh pass keeps the row fresh as CINC-side edits land
 *  (vendor reassignment, address corrections, EstimateTotal updates).
 *
 *  Exported for the one-time backfill in scripts/backfill-cinc-wo-details.ts. */
export async function upsertWorkOrderDetails(ticketId: number, wo: CincWorkOrder): Promise<void> {
  // CINC.EstimateTotal is a dollar amount (number). The sample we've
  // seen is 0. If CINC ever returns fractional cents we'll need to
  // revisit, but × 100 + round is the conventional dollar→cents move.
  const cents =
    typeof wo.EstimateTotal === 'number' && wo.EstimateTotal > 0
      ? Math.round(wo.EstimateTotal * 100)
      : null

  // Vendor: CINC frequently shows NO vendor on a WO even after staff assigned
  // one in MAIA, so an inbound refresh must NOT clear it — only overwrite when
  // CINC actually carries a vendor. Otherwise keep what's already on the row.
  let vendorName: string | null = wo.Vendor ?? null
  let vendorId:   number | null = wo.VendorId && wo.VendorId > 0 ? wo.VendorId : null
  if (!vendorId) {
    const { data: prev } = await supabaseAdmin.from('work_order_details').select('vendor_name, cinc_vendor_id').eq('ticket_id', ticketId).maybeSingle()
    if (prev?.cinc_vendor_id) { vendorId = prev.cinc_vendor_id as number; vendorName = (prev.vendor_name as string | null) ?? vendorName }
  }

  const row = {
    ticket_id:           ticketId,
    cinc_ho_id:          wo.HoID                 ?? null,
    cinc_property_id:    wo.PropertyId           ?? null,
    work_location_name:  wo.WorkLocationName     ?? null,
    address_line1:       wo.AddressLine1         ?? null,
    address_line2:       wo.AddressLine2         ?? null,
    city:                wo.City                 ?? null,
    state:               wo.State                ?? null,
    zip:                 wo.Zip                  ?? null,
    vendor_name:         vendorName,
    cinc_vendor_id:      vendorId,
    scheduled_at:        parseCincTimestamp(wo.IssuedDate),
    cost_cents:          cents,
  }

  const { error } = await supabaseAdmin
    .from('work_order_details')
    .upsert(row, { onConflict: 'ticket_id' })

  if (error) {
    throw new Error(`work_order_details upsert failed for ticket_id=${ticketId}: ${error.message}`)
  }
}

/** Insert a CINC note as an inbound ticket_message if we haven't seen it
 *  yet. Returns 1 if inserted, 0 if it was a dedupe. Soft-deleted notes
 *  (NoteDeletedDate set) are skipped. */
async function insertNoteIfNew(ticketId: number, note: CincNote): Promise<number> {
  const externalId = String(note.NoteId)
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('ticket_messages')
    .select('id')
    .eq('channel',     CINC_CHANNEL)
    .eq('external_id', externalId)
    .maybeSingle()
  if (findErr) throw new Error(`ticket_messages dedup lookup failed: ${findErr.message}`)
  if (existing) return 0

  const { error: insertErr } = await supabaseAdmin
    .from('ticket_messages')
    .insert({
      ticket_id:    ticketId,
      direction:    'inbound',
      channel:      CINC_CHANNEL,
      from_addr:    note.NoteCreatedBy ?? 'cinc',
      body:         note.NoteDescription,
      external_id:  externalId,
      cinc_note_id: externalId,
      created_at:   parseCincTimestamp(note.NoteCreatedDate) ?? new Date().toISOString(),
    })
  if (insertErr) {
    // 23505 = duplicate key (race condition with concurrent cron) — treat as ok.
    if (String(insertErr.code) === '23505') return 0
    throw new Error(`ticket_message insert failed for cinc_note_id=${externalId}: ${insertErr.message}`)
  }
  return 1
}

/** Two-pass sync. Discovery first (catches NEW work orders), then refresh
 *  (catches updates on existing non-closed work orders). */
export interface SyncResult {
  discoveryCount: number   // CINC work orders returned by createdFromDate query
  refreshCount:   number   // existing tickets re-fetched in refresh pass
  ticketsInserted: number
  ticketsUpdated:  number
  notesInserted:   number
  newCursor:       string  // ISO timestamp written back to cinc_sync_state
  errors:          string[]
}

export async function syncCincInbound(): Promise<SyncResult> {
  const errors: string[] = []
  const totals = { ticketsInserted: 0, ticketsUpdated: 0, notesInserted: 0 }

  // Read cursor.
  const { data: state, error: stateErr } = await supabaseAdmin
    .from('cinc_sync_state')
    .select('cursor')
    .eq('id', 1)
    .single()
  if (stateErr) throw new Error(`cinc_sync_state read failed: ${stateErr.message}`)
  const cursor = state?.cursor ?? new Date(Date.now() - 30 * 86_400_000).toISOString()

  // ─── Pass 1: discovery ───────────────────────────────────────────────
  let discovered: CincWorkOrder[] = []
  try {
    discovered = await cinc.listWorkOrdersCreatedSince(cursor)
  } catch (err) {
    errors.push(`discovery: ${(err as Error).message}`)
  }
  for (const wo of discovered) {
    try {
      const c = await upsertWorkOrder(wo)
      totals.ticketsInserted += c.ticketsInserted
      totals.ticketsUpdated  += c.ticketsUpdated
      totals.notesInserted   += c.notesInserted
    } catch (err) {
      errors.push(`upsert WO ${wo.WorkOrderId}: ${(err as Error).message}`)
    }
  }

  // Advance cursor to the max CreatedDate we saw. Fallback: stay put if
  // discovery failed or returned nothing.
  const maxCreated = discovered.reduce<string>((acc, w) => {
    const d = w.CreatedDate ?? ''
    return d > acc ? d : acc
  }, '')
  const newCursor = maxCreated || cursor

  // ─── Pass 2: refresh existing non-closed work orders ─────────────────
  const { data: openTickets, error: openErr } = await supabaseAdmin
    .from('tickets')
    .select('id, cinc_workorder_id')
    .not('cinc_workorder_id', 'is', null)
    .not('status', 'in', '("resolved","closed")')
    .limit(200)
  if (openErr) errors.push(`open-tickets lookup: ${openErr.message}`)

  let refreshCount = 0
  for (const t of (openTickets ?? [])) {
    refreshCount++
    const woId = Number(t.cinc_workorder_id)
    if (!Number.isFinite(woId)) continue
    try {
      const wo = await cinc.getWorkOrderById(woId)
      if (!wo) continue
      const c = await upsertWorkOrder(wo)
      totals.ticketsInserted += c.ticketsInserted    // always 0 in refresh pass — already exists
      totals.ticketsUpdated  += c.ticketsUpdated
      totals.notesInserted   += c.notesInserted
    } catch (err) {
      errors.push(`refresh WO ${woId}: ${(err as Error).message}`)
    }
  }

  // ─── Update sync state ───────────────────────────────────────────────
  await supabaseAdmin
    .from('cinc_sync_state')
    .update({
      cursor:      newCursor,
      last_run_at: new Date().toISOString(),
      last_error:  errors.length > 0 ? errors.slice(0, 10).join('; ').slice(0, 2000) : null,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', 1)

  return {
    discoveryCount: discovered.length,
    refreshCount,
    ticketsInserted: totals.ticketsInserted,
    ticketsUpdated:  totals.ticketsUpdated,
    notesInserted:   totals.notesInserted,
    newCursor,
    errors,
  }
}
