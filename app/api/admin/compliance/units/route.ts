// =====================================================================
// GET /api/admin/compliance/units?assoc=CODE
// Owners/units in an association + their unit-scope compliance records, so
// the Compliance Hub can show each unit's present / missing documents and
// the document-intake picker can choose the owner. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  const [{ data: ownerRows }, { data: recRows }] = await Promise.all([
    supabaseAdmin.from('owners')
      .select('account_number, first_name, last_name, unit_number')
      .eq('association_code', assoc).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('compliance_records')
      .select('unit_ref, item_key, status, expiry_date, source_path')
      .eq('association_code', assoc).eq('scope', 'unit'),
  ])

  // Documents attach to the UNIT, not each owner record — so collapse co-owners
  // and duplicate (e.g. developer / null-account) rows into one row per physical
  // unit. unit_ref (account_number) prefers a real CINC account so on-file docs
  // match; owner names are combined for the label.
  interface UnitGroup { unit_number: string | null; account: string | null; names: string[] }
  const byUnit = new Map<string, UnitGroup>()
  for (const o of ownerRows ?? []) {
    const unit = (o.unit_number as string | null)?.trim() || null
    const acct = (o.account_number as string | null)?.trim() || null
    const key = unit ? `u:${unit}` : acct ? `a:${acct}` : null
    if (!key) continue
    let g = byUnit.get(key)
    if (!g) { g = { unit_number: unit, account: null, names: [] }; byUnit.set(key, g) }
    if (!g.account && acct) g.account = acct
    const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
    if (name && !g.names.includes(name)) g.names.push(name)
  }

  const owners = [...byUnit.values()].map(g => {
    const ref = g.account ?? g.unit_number ?? ''
    const primary = g.names[0] ?? 'Owner'
    const more = g.names.length > 1 ? ` +${g.names.length - 1}` : ''
    const unitLabel = g.unit_number ? `Unit ${g.unit_number}` : (g.account ?? 'Unit')
    return { account_number: ref, unit_number: g.unit_number, label: `${unitLabel} · ${primary}${more}` }
  }).sort((a, b) => (a.unit_number ?? a.account_number).localeCompare(b.unit_number ?? b.account_number, undefined, { numeric: true }))

  return NextResponse.json({ owners, records: recRows ?? [] })
}
