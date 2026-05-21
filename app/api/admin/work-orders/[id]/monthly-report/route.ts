// =====================================================================
// PATCH /api/admin/work-orders/[id]/monthly-report
//
// Sets tickets.marked_for_monthly_report for one work order — the flag
// that decides whether it shows up in /admin/reports/monthly. Toggled
// from the work-order detail page.
//
// Body: { marked: boolean }
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  let body: { marked?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  if (typeof body.marked !== 'boolean') {
    return NextResponse.json({ error: 'marked (boolean) is required' }, { status: 400 })
  }
  const marked = body.marked

  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from('tickets')
    .select('id, type')
    .eq('id', ticketId)
    .maybeSingle()
  if (ticketErr) {
    return NextResponse.json({ error: `Ticket lookup failed: ${ticketErr.message}` }, { status: 500 })
  }
  // Both tickets and work orders can be flagged for the monthly report.
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

  const { error: updErr } = await supabaseAdmin
    .from('tickets')
    .update({ marked_for_monthly_report: marked })
    .eq('id', ticketId)
  if (updErr) {
    return NextResponse.json({ error: `Update failed: ${updErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, marked })
}
