// =====================================================================
// /api/admin/sunbiz
//
// GET  → every active association joined with its annual-report record
//        for the requested year (?year=YYYY, defaults to current).
// POST → upsert a filing record for (association_code, report_year):
//        mark filed (filed_date + confirmation #), update, or clear.
//
// Staff-only. Status is derived client-side via lib/sunbiz.ts.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { currentReportYear, type AssociationAnnualReport } from '@/lib/sunbiz'

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
function cleanDate(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
function cleanText(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return s.length ? s : null
}

interface AssocRow {
  association_code: string
  association_name: string | null
  sunbiz_document_number: string | null
  sunbiz_status: string | null
}

export async function GET(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const yearParam = parseInt(url.searchParams.get('year') ?? '', 10)
  const year = Number.isFinite(yearParam) ? yearParam : currentReportYear()

  const [{ data: assocs, error: aErr }, { data: reports, error: rErr }] = await Promise.all([
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name, sunbiz_document_number, sunbiz_status')
      .eq('active', true)
      .order('association_name', { ascending: true }),
    supabaseAdmin
      .from('association_annual_reports')
      .select('*')
      .eq('report_year', year),
  ])
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })

  const byCode = new Map<string, AssociationAnnualReport>()
  for (const r of (reports ?? []) as AssociationAnnualReport[]) byCode.set(r.association_code, r)

  const rows = ((assocs ?? []) as AssocRow[]).map(a => ({
    association_code:       a.association_code,
    association_name:       a.association_name,
    sunbiz_document_number: a.sunbiz_document_number,
    sunbiz_status:          a.sunbiz_status,
    report:                 byCode.get(a.association_code) ?? null,
  }))

  return NextResponse.json({ year, rows })
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const code = cleanText(body.association_code)?.toUpperCase()
  const year = cleanNumber(body.report_year)
  if (!code || !year) {
    return NextResponse.json({ error: 'association_code and report_year are required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('association_annual_reports')
    .upsert({
      association_code:    code,
      report_year:         year,
      filed_date:          cleanDate(body.filed_date),
      confirmation_number: cleanText(body.confirmation_number),
      fee_paid_usd:        cleanNumber(body.fee_paid_usd),
      filed_by_email:      actorEmail(session),
      notes:               cleanText(body.notes),
    }, { onConflict: 'association_code,report_year' })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, report: data as AssociationAnnualReport })
}
