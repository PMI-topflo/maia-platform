// POST /api/admin/associations/[code]/unit-insurance
// File a unit-owner HO-6 policy onto a unit (unit_insurance), e.g. when the
// declaration reader detects an HO-6 and routes it to the owner. Staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const dateOrNull = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null
const text = (v: unknown) => { const s = (typeof v === 'string' ? v : '').trim(); return s.length ? s : null }
const numOrNull = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null }

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const assoc = (code ?? '').trim().toUpperCase()
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const account = String(body.account_number ?? '').trim().toUpperCase()
  if (!account) return NextResponse.json({ error: 'account_number (the unit) is required' }, { status: 400 })
  if (!account.startsWith(assoc)) return NextResponse.json({ error: 'account_number does not belong to this association' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('unit_insurance').insert({
    account_number:  account,
    association_code: assoc,
    carrier:         text(body.carrier),
    policy_number:   text(body.policy_number),
    effective_date:  dateOrNull(body.effective_date),
    expiration_date: dateOrNull(body.expiration_date),
    premium_usd:     numOrNull(body.premium_usd),
    source_pdf_url:  text(body.source_path),   // where the uploaded dec lives
    notes:           text(body.notes) ?? 'Filed from the insurance declaration reader (HO-6 detected).',
    extracted_by:    'claude',
    extracted_at:    new Date().toISOString(),
  }).select('id, account_number, carrier, expiration_date').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, policy: data })
}
