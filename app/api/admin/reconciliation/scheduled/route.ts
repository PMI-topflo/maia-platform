// =====================================================================
// /api/admin/reconciliation/scheduled
//
// POST → create a manual future payment. When `months` > 1 the same
//        amount is scheduled for that many consecutive months starting
//        at due_month (insurance-installment plans), all sharing a
//        series_id so they can be managed together.
//
// Staff-only. Reads live in the reconciliation "Upcoming Payments"
// section via /api/admin/reconciliation/upcoming.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
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
function actorEmail(session: { userId: string | number }): string | null {
  return typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase() : null
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

/** Add n months to a 'YYYY-MM' string. */
function addMonths(yyyymm: string, n: number): string {
  const [y, m] = yyyymm.split('-').map(Number)
  const d = new Date(Date.UTC(y, (m - 1) + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const association_code = cleanText(body.association_code)?.toUpperCase()
  const due_month = cleanText(body.due_month)
  const amount = cleanAmount(body.amount)
  if (!association_code || !due_month || !/^\d{4}-\d{2}$/.test(due_month) || amount == null) {
    return NextResponse.json({ error: 'association_code, due_month (YYYY-MM) and amount are required' }, { status: 400 })
  }

  const months = Math.max(1, Math.min(36, Number(body.months) || 1))
  const direction = body.direction === 'inflow' ? 'inflow' : 'outflow'
  const seriesId = months > 1 ? randomUUID() : null
  const actor = actorEmail(session)

  const rows = Array.from({ length: months }, (_, i) => ({
    association_code,
    bank_account_id:  body.bank_account_id ? Number(body.bank_account_id) : null,
    due_month:        addMonths(due_month, i),
    due_date:         (typeof body.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) && i === 0) ? body.due_date : null,
    vendor_payee:     cleanText(body.vendor_payee),
    description:      cleanText(body.description),
    category:        cleanText(body.category),
    amount,
    direction,
    series_id:        seriesId,
    status:          'pending' as const,
    notes:           cleanText(body.notes),
    created_by_email: actor,
  }))

  const { data, error } = await supabaseAdmin
    .from('scheduled_payments')
    .insert(rows)
    .select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, created: data?.length ?? 0, payments: data })
}
