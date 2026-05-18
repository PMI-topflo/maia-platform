// =====================================================================
// POST /api/admin/work-orders/[id]/push-to-cinc
//
// Enqueues the existing 'create' outbox op for a MAIA-only work order
// so the next cron tick pushes it into CINC. After the cron drains
// the row, the ticket's cinc_workorder_id will be populated.
//
// 409 if the WO already has a cinc_workorder_id (no-op).
// 400 if not a work_order ticket.
// 412 if CINC_SYNC_ENABLED is not true on the server.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { enqueueOutbox } from '@/lib/tickets'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  if (process.env.CINC_SYNC_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'CINC sync is disabled on this server (CINC_SYNC_ENABLED is not "true")' },
      { status: 412 },
    )
  }

  const { data: ticket, error } = await supabaseAdmin
    .from('tickets')
    .select('id, type, cinc_workorder_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: `lookup failed: ${error.message}` }, { status: 500 })
  }
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  if (ticket.type !== 'work_order') {
    return NextResponse.json({ error: 'Not a work order' }, { status: 400 })
  }
  if (ticket.cinc_workorder_id) {
    return NextResponse.json({ error: 'Already synced to CINC', cinc_workorder_id: ticket.cinc_workorder_id }, { status: 409 })
  }

  await enqueueOutbox(ticketId, 'ticket', 'create', 'cinc')

  return NextResponse.json({ ok: true, message: 'Queued. Next cron tick (~1 min) will push to CINC.' })
}
