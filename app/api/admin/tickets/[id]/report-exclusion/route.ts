// =====================================================================
// PATCH /api/admin/tickets/[id]/report-exclusion
//
// Sets tickets.excluded_from_monthly_report for one ticket or work
// order. The monthly report covers every item for the month by default;
// staff untick the ones to leave out in the report preview, which calls
// this. Body: { excluded: boolean }
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

  let body: { excluded?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  if (typeof body.excluded !== 'boolean') {
    return NextResponse.json({ error: 'excluded (boolean) is required' }, { status: 400 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('tickets')
    .update({ excluded_from_monthly_report: body.excluded })
    .eq('id', ticketId)
    .select('id')
  if (error) {
    return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, excluded: body.excluded })
}
