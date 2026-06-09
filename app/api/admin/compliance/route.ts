// =====================================================================
// GET /api/admin/compliance?assoc=CODE&scope=association[&unit=REF]
//     → stored compliance records for that association/scope.
// PUT /api/admin/compliance  { association_code, scope, unit_ref?, records:[...] }
//     → bulk upsert applicability/status/expiry. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SELECT = 'item_key, applicable, status, expiry_date, notes'
const STATUSES = ['current', 'expiring', 'pending', 'missing', 'non_compliant', 'na']
const SCOPES = ['association', 'unit']
const dateOrNull = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null

async function requireStaff() {
  const cookieStore = await cookies()
  const token   = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

export async function GET(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp    = new URL(req.url).searchParams
  const assoc = (sp.get('assoc') ?? '').trim().toUpperCase()
  const scope = SCOPES.includes(sp.get('scope') ?? '') ? sp.get('scope')! : 'association'
  const unit  = (sp.get('unit') ?? '').trim()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  let q = supabaseAdmin.from('compliance_records').select(SELECT).eq('association_code', assoc).eq('scope', scope)
  if (scope === 'unit') q = q.eq('unit_ref', unit)
  const { data, error } = await q
  if (error) return NextResponse.json({ records: [], error: error.message })   // table may not exist pre-migration
  return NextResponse.json({ records: data ?? [] })
}

export async function PUT(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const assoc = String(body.association_code ?? '').trim().toUpperCase()
  const scope = SCOPES.includes(String(body.scope)) ? String(body.scope) : 'association'
  const unit  = scope === 'unit' ? String(body.unit_ref ?? '').trim() : ''
  const records = Array.isArray(body.records) ? body.records : null
  if (!assoc || !records) return NextResponse.json({ error: 'association_code and records[] are required' }, { status: 400 })
  const updatedBy = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const rows = records
    .map((r): Record<string, unknown> | null => {
      const item_key = String((r as Record<string, unknown>).item_key ?? '').trim()
      if (!item_key) return null
      const rec = r as Record<string, unknown>
      const status = STATUSES.includes(String(rec.status)) ? String(rec.status) : 'missing'
      return {
        scope, association_code: assoc, unit_ref: unit, item_key,
        applicable: rec.applicable !== false,
        status: rec.applicable === false ? 'na' : status,
        expiry_date: dateOrNull(rec.expiry_date),
        notes: String(rec.notes ?? '').trim() || null,
        updated_by: updatedBy,
      }
    })
    .filter((r): r is Record<string, unknown> => r !== null)
  if (rows.length === 0) return NextResponse.json({ error: 'no valid records' }, { status: 400 })

  const { error } = await supabaseAdmin.from('compliance_records')
    .upsert(rows, { onConflict: 'scope,association_code,unit_ref,item_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, saved: rows.length })
}
