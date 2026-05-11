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
      due_at:               wo.DueDate ?? null,
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
    // Update if status / subject / type changed. Don't overwrite manual
    // edits (e.g., staff reclassified work_order → ticket via PR #27 —
    // we don't touch the type field on refresh).
    const patch: Record<string, unknown> = {}
    if (existing.status               !== status)                                   patch.status               = status
    if ((existing.subject ?? '')      !== subject)                                  patch.subject              = subject
    if ((existing.summary ?? '')      !== description.slice(0, 500))                patch.summary              = description.slice(0, 500)
    if (existing.work_order_type_id   !== (wo.WorkOrderTypId ?? null))              patch.work_order_type_id   = wo.WorkOrderTypId ?? null
    if ((existing.work_order_type_name ?? null) !== (wo.WorkOrderType  ?? null))    patch.work_order_type_name = wo.WorkOrderType  ?? null
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

  // Sync notes — idempotent via (channel, external_id) unique index.
  for (const note of (wo.Notes ?? [])) {
    counts.notesInserted += await insertNoteIfNew(ticketId, note)
  }

  return counts
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
      created_at:   note.NoteCreatedDate,
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
