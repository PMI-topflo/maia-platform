// =====================================================================
// lib/integrations/outbox-handler.ts
// Drains rows from integration_outbox by dispatching to the right
// integration client. Each row's `target` selects the client; the
// (entity_type, operation) pair selects the action.
//
// Phase A surface — CINC only:
//   ('ticket',         'create')         → cinc.createLinkedWorkOrder
//   ('ticket_message', 'append_message') → cinc.addWorkOrderNote
//
// Anything else is logged and marked failed so it doesn't retry forever.
// Rentvine handlers slot in here when their endpoint catalog lands.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import * as cinc from './cinc'

interface OutboxRow {
  id:           number
  target:       'cinc' | 'rentvine'
  entity_type:  'ticket' | 'ticket_message'
  entity_id:    number
  operation:    'create' | 'update' | 'append_message' | 'close'
  payload:      Record<string, unknown>
  attempts:     number
}

const MAX_ATTEMPTS    = 5
const BACKOFF_MINUTES = [1, 5, 15, 60, 240]  // 1m, 5m, 15m, 1h, 4h

function nextRetryAt(attemptsSoFar: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(attemptsSoFar, BACKOFF_MINUTES.length - 1)]
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

/** Fetch up to `limit` pending outbox rows whose retry window has come. */
export async function fetchDuePending(limit = 25): Promise<OutboxRow[]> {
  const { data, error } = await supabaseAdmin
    .from('integration_outbox')
    .select('id, target, entity_type, entity_id, operation, payload, attempts')
    .eq('status', 'pending')
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`outbox fetch failed: ${error.message}`)
  return (data ?? []) as OutboxRow[]
}

async function markSucceeded(rowId: number): Promise<void> {
  await supabaseAdmin
    .from('integration_outbox')
    .update({ status: 'succeeded', succeeded_at: new Date().toISOString(), last_error: null })
    .eq('id', rowId)
}

async function markFailedOrRetry(rowId: number, attempts: number, err: unknown): Promise<void> {
  const nextAttempts = attempts + 1
  const message = err instanceof Error ? err.message : String(err)
  if (nextAttempts >= MAX_ATTEMPTS) {
    await supabaseAdmin
      .from('integration_outbox')
      .update({ status: 'failed', attempts: nextAttempts, last_error: message })
      .eq('id', rowId)
    return
  }
  await supabaseAdmin
    .from('integration_outbox')
    .update({
      attempts:      nextAttempts,
      next_retry_at: nextRetryAt(nextAttempts),
      last_error:    message,
    })
    .eq('id', rowId)
}

// ─────────────────────────────────────────────────────────────────────
// CINC dispatchers
// ─────────────────────────────────────────────────────────────────────
async function handleCincTicketCreate(ticketId: number): Promise<void> {
  const { data: t, error } = await supabaseAdmin
    .from('tickets')
    .select('id, subject, summary, association_code, contact_email, contact_phone, contact_name, due_at, cinc_workorder_id')
    .eq('id', ticketId)
    .single()
  if (error || !t) throw new Error(`ticket ${ticketId} not found`)

  // Idempotency: already mirrored — skip.
  if (t.cinc_workorder_id) return

  if (!t.association_code) {
    throw new Error(`ticket ${ticketId} has no association_code; CINC requires one`)
  }

  const { workOrderId } = await cinc.createLinkedWorkOrder({
    associationCode: t.association_code,
    description:     `${t.subject ?? ''}\n\n${t.summary ?? ''}`.trim(),
    dueDate:         t.due_at,
    contactEmail:    t.contact_email,
    contactPhone:    t.contact_phone,
    contactName:     t.contact_name,
    initialNote:     t.summary,
  })

  await supabaseAdmin
    .from('tickets')
    .update({
      cinc_workorder_id: String(workOrderId),
      sync_status:       { ...(t as Record<string, unknown>).sync_status as object, cinc: { ok: true, last_synced_at: new Date().toISOString() } },
    })
    .eq('id', ticketId)
}

async function handleCincMessageAppend(messageId: number): Promise<void> {
  const { data: m, error: mErr } = await supabaseAdmin
    .from('ticket_messages')
    .select('id, ticket_id, body, direction, channel, cinc_note_id')
    .eq('id', messageId)
    .single()
  if (mErr || !m) throw new Error(`ticket_message ${messageId} not found`)
  if (m.cinc_note_id)         return  // already synced
  if (m.direction === 'internal_note') return  // internal-only never leaves

  const { data: t } = await supabaseAdmin
    .from('tickets')
    .select('cinc_workorder_id')
    .eq('id', m.ticket_id)
    .single()
  if (!t?.cinc_workorder_id) {
    throw new Error(`parent ticket ${m.ticket_id} has no cinc_workorder_id yet`)
  }

  await cinc.addWorkOrderNote(
    Number(t.cinc_workorder_id),
    m.body ?? '',
    { isPublic: true, emailToVendor: m.direction === 'outbound' },
  )

  // We don't get the new note id back from /workOrderNotes (Swagger
  // shows {} response). Mark synced via a sentinel so we don't retry.
  await supabaseAdmin
    .from('ticket_messages')
    .update({ cinc_note_id: 'synced' })
    .eq('id', messageId)
}

// ─────────────────────────────────────────────────────────────────────
// Main dispatch
// ─────────────────────────────────────────────────────────────────────
export async function processOne(row: OutboxRow): Promise<void> {
  try {
    if (row.target === 'cinc') {
      if (row.entity_type === 'ticket' && row.operation === 'create') {
        await handleCincTicketCreate(row.entity_id)
      } else if (row.entity_type === 'ticket_message' && row.operation === 'append_message') {
        await handleCincMessageAppend(row.entity_id)
      } else {
        // Status-update sync etc. — wired in Phase A.5
        throw new Error(`Unhandled cinc op: ${row.entity_type}/${row.operation}`)
      }
    } else if (row.target === 'rentvine') {
      // Rentvine handlers ship once their endpoint catalog is locked down
      throw new Error('rentvine handlers not implemented yet')
    } else {
      throw new Error(`Unknown target: ${row.target}`)
    }
    await markSucceeded(row.id)
  } catch (err) {
    console.error(`[outbox] row ${row.id} (${row.target}/${row.entity_type}/${row.operation}) failed:`, err instanceof Error ? err.message : err)
    await markFailedOrRetry(row.id, row.attempts, err)
  }
}

export async function drainBatch(limit = 25): Promise<{ processed: number; ok: number; failed: number }> {
  const rows = await fetchDuePending(limit)
  let ok = 0
  let failed = 0
  for (const row of rows) {
    const before = await supabaseAdmin
      .from('integration_outbox')
      .select('status')
      .eq('id', row.id)
      .single()
    if (before.data?.status !== 'pending') continue
    await processOne(row)
    const after = await supabaseAdmin
      .from('integration_outbox')
      .select('status')
      .eq('id', row.id)
      .single()
    if (after.data?.status === 'succeeded') ok++
    else                                    failed++
  }
  return { processed: rows.length, ok, failed }
}
