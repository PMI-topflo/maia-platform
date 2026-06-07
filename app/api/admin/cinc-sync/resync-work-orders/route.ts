// =====================================================================
// POST /api/admin/cinc-sync/resync-work-orders
//
// Re-drives every MAIA work order that hasn't synced to CINC yet
// (cinc_workorder_id IS NULL, association_code present) back through the
// outbox 'create' path:
//   - resets any failed/stale 'create' row to pending (attempts cleared)
//   - enqueues a fresh 'create' for WOs that have no outbox row at all
//     (e.g. created while CINC_SYNC was off)
//
// The drain cron then retries them with the current code — which now
// resolves AssocId via /associations (no manual seed WO needed) and caps
// the CINC description at 100 chars. Idempotent: re-running only resets
// rows that haven't succeeded and never double-enqueues.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function POST() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.CINC_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ error: 'CINC sync is disabled (CINC_SYNC_ENABLED is not "true").' }, { status: 400 })
  }

  // Unsynced work orders that have an association to resolve.
  const { data: tickets, error } = await supabaseAdmin
    .from('tickets')
    .select('id')
    .eq('type', 'work_order')
    .is('cinc_workorder_id', null)
    .not('association_code', 'is', null)
  if (error) return NextResponse.json({ error: `Ticket query failed: ${error.message}` }, { status: 500 })

  const ids = (tickets ?? []).map(t => t.id as number)
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, unsynced: 0, reset: 0, enqueued: 0 })
  }

  // Existing cinc 'create' rows for these tickets.
  const { data: existing } = await supabaseAdmin
    .from('integration_outbox')
    .select('id, entity_id, status')
    .eq('target', 'cinc')
    .eq('entity_type', 'ticket')
    .eq('operation', 'create')
    .in('entity_id', ids)

  const haveRowFor = new Set<number>((existing ?? []).map(r => r.entity_id as number))
  const toReset    = (existing ?? []).filter(r => r.status !== 'succeeded').map(r => r.id as number)

  let reset = 0
  if (toReset.length) {
    const { error: resetErr, count } = await supabaseAdmin
      .from('integration_outbox')
      .update({ status: 'pending', attempts: 0, next_retry_at: new Date().toISOString(), last_error: null }, { count: 'exact' })
      .in('id', toReset)
    if (resetErr) return NextResponse.json({ error: `Reset failed: ${resetErr.message}` }, { status: 500 })
    reset = count ?? toReset.length
  }

  // Tickets with no create row at all → enqueue one.
  const missing = ids.filter(id => !haveRowFor.has(id))
  let enqueued = 0
  if (missing.length) {
    const rows = missing.map(id => ({
      target: 'cinc', entity_type: 'ticket', entity_id: id, operation: 'create', payload: {},
    }))
    const { error: insErr } = await supabaseAdmin.from('integration_outbox').insert(rows)
    if (insErr) return NextResponse.json({ error: `Enqueue failed: ${insErr.message}` }, { status: 500 })
    enqueued = rows.length
  }

  return NextResponse.json({ ok: true, unsynced: ids.length, reset, enqueued })
}
