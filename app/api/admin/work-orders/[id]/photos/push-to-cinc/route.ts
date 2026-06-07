// =====================================================================
// POST /api/admin/work-orders/[id]/photos/push-to-cinc
//
// [id] = ticket id.
//
// Backfill: enqueue a push_photo outbox event for every MAIA-origin photo
// (source 'email' / 'staff_upload') on this work order that hasn't been
// pushed to CINC yet (cinc_pushed_at IS NULL). The outbox drain cron then
// uploads them into the linked CINC work order, exactly once.
//
// Used for photos that landed before the WO was CINC-linked, or to retry
// after a failed push. New photos push automatically on arrival — this is
// the manual/backfill lever.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { enqueuePendingPhotoPushes } from '@/lib/integrations/outbox-handler'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idParam } = await ctx.params
  const ticketId = Number(idParam)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  const { data: ticket, error } = await supabaseAdmin
    .from('tickets')
    .select('id, cinc_workorder_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (error)  return NextResponse.json({ error: `Ticket lookup failed: ${error.message}` }, { status: 500 })
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

  if (!ticket.cinc_workorder_id) {
    return NextResponse.json(
      { error: 'This work order is not linked to CINC yet — photos will push automatically once it links.' },
      { status: 400 },
    )
  }
  if (process.env.CINC_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ error: 'CINC sync is disabled (CINC_SYNC_ENABLED is not "true").' }, { status: 400 })
  }

  const queued = await enqueuePendingPhotoPushes(ticketId)
  return NextResponse.json({ ok: true, queued })
}
