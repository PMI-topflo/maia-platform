// =====================================================================
// /api/admin/reconciliation/scheduled/[id]
//
// PATCH  → mark paid / pending / cancelled, or edit fields.
//          { action: 'mark_paid' | 'mark_pending' | 'cancel' } or a
//          partial field update.
// DELETE  → remove this row. ?series=1 removes the whole installment
//          series (all rows sharing its series_id).
//
// Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

async function requireStaff() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return session
}
function cleanText(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return s.length ? s : null
}
function cleanAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? Math.abs(n) : null
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const todayISO = new Date().toISOString().slice(0, 10)
  let patch: Record<string, unknown>
  if (body.action === 'mark_paid')         patch = { status: 'paid', paid_date: cleanText(body.paid_date) ?? todayISO }
  else if (body.action === 'mark_pending') patch = { status: 'pending', paid_date: null }
  else if (body.action === 'cancel')       patch = { status: 'cancelled' }
  else {
    patch = {}
    if ('vendor_payee' in body) patch.vendor_payee = cleanText(body.vendor_payee)
    if ('description'  in body) patch.description  = cleanText(body.description)
    if ('category'     in body) patch.category     = cleanText(body.category)
    if ('amount'       in body) patch.amount       = cleanAmount(body.amount)
    if ('due_month'    in body && /^\d{4}-\d{2}$/.test(String(body.due_month))) patch.due_month = body.due_month
    if ('notes'        in body) patch.notes        = cleanText(body.notes)
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('scheduled_payments').update(patch).eq('id', id).select('*').maybeSingle()
  if (error)  return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, payment: data })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const wholeSeries = new URL(req.url).searchParams.get('series') === '1'

  if (wholeSeries) {
    const { data: row } = await supabaseAdmin.from('scheduled_payments').select('series_id').eq('id', id).maybeSingle()
    if (row?.series_id) {
      const { error } = await supabaseAdmin.from('scheduled_payments').delete().eq('series_id', row.series_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, scope: 'series' })
    }
  }
  const { error } = await supabaseAdmin.from('scheduled_payments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, scope: 'row' })
}
