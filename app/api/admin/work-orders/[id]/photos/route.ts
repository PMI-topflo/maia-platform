// =====================================================================
// GET  /api/admin/work-orders/[id]/photos
// GET  /api/admin/work-orders/[id]/photos?refresh=1
//
// [id] = ticket id (the same id used by /admin/tickets/[id]).
//
// Lists photo attachments for a work order. On first call (no rows
// in the local mirror yet), or when ?refresh=1 is passed, MAIA pulls
// from CINC's /workOrderAttachments endpoint, decodes the base64
// bodies, uploads them to the `work-order-photos` bucket, and inserts
// rows in `work_order_attachments`. Subsequent calls read from the
// mirror only — no CINC round-trip.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  mirrorCincWorkOrderPhotos,
  listAttachmentsWithUrls,
} from '@/lib/work-order-attachments'

export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from('tickets')
    .select('id, type, cinc_workorder_id')
    .eq('id', ticketId)
    .maybeSingle()

  if (ticketErr) {
    return NextResponse.json({ error: `Ticket lookup failed: ${ticketErr.message}` }, { status: 500 })
  }
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  if (ticket.type !== 'work_order') {
    return NextResponse.json({ error: 'Not a work order' }, { status: 400 })
  }

  const url     = new URL(req.url)
  const refresh = url.searchParams.get('refresh') === '1'

  let syncResult: { mirrored: number; skipped: number; errors: string[] } | null = null
  const cincIdRaw = ticket.cinc_workorder_id as string | null
  const cincId    = cincIdRaw ? Number(cincIdRaw) : null

  if (cincId && Number.isFinite(cincId) && cincId > 0) {
    let shouldMirror = refresh
    if (!shouldMirror) {
      // First-view trigger: only mirror if we've never mirrored this WO before.
      const { count } = await supabaseAdmin
        .from('work_order_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('ticket_id', ticketId)
        .eq('source', 'cinc')
      shouldMirror = (count ?? 0) === 0
    }

    if (shouldMirror) {
      syncResult = await mirrorCincWorkOrderPhotos({ ticketId, cincWorkOrderId: cincId })
    }
  }

  const attachments = await listAttachmentsWithUrls(ticketId)

  return NextResponse.json({
    attachments,
    sync:        syncResult,                       // null if we didn't sync this call
    has_cinc_id: cincId !== null,
  })
}
