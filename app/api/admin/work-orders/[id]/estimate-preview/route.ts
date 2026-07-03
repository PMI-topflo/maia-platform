// GET /api/admin/work-orders/[id]/estimate-preview?erv=<ervId>
// A vendor's estimate rendered as inline images for the staff comparison
// panel (thumbnails / lightbox). The erv must belong to an estimate request
// on THIS work order. Staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { estimatePagesForErv } from '@/lib/estimate-preview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const ticketId = parseInt(id, 10)
  const erv = new URL(req.url).searchParams.get('erv') ?? ''
  if (!Number.isFinite(ticketId) || !erv) return NextResponse.json({ pages: [] })

  // Authorize: the vendor's RFQ must be on this work order.
  const { data: row } = await supabaseAdmin.from('estimate_request_vendors').select('request_id').eq('id', erv).maybeSingle()
  if (!row?.request_id) return NextResponse.json({ pages: [] })
  const { data: reqRow } = await supabaseAdmin.from('estimate_requests').select('ticket_id').eq('id', row.request_id).maybeSingle()
  if (!reqRow || Number(reqRow.ticket_id) !== ticketId) return NextResponse.json({ pages: [] })

  return NextResponse.json({ pages: await estimatePagesForErv(erv) })
}
