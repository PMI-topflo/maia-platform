// GET /api/admin/pre-apply/units?assoc=MANXI
// The unit/account list for one association, with owner + a best-known
// occupancy status — powers the "Open an application" unit picker so staff
// choose a real unit instead of free-typing a number, and see who the owner
// is and whether it's leased/owner-occupied/vacant before opening the
// application. Staff-only.
//
// occupancy comes from unit_occupancy.status when a staff member has set it
// explicitly (association_audit.ts's own source of truth). Nothing infers
// owner-occupied vs vacant from other data — there is no reliable signal for
// that distinction — but a unit with an active unit_tenant_contacts record
// and no explicit status is still worth flagging as (likely leased) rather
// than showing nothing.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface UnitOption {
  unit: string
  accountNumber: string
  ownerName: string | null
  occupancy: 'owner_occupied' | 'leased' | 'vacant' | null
  occupancyKnown: boolean
  tenantName: string | null
}

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ units: [] })

  const [{ data: owners }, { data: occ }, { data: tenants }] = await Promise.all([
    supabaseAdmin.from('owners')
      .select('account_number, unit_number, first_name, last_name, entity_name')
      .eq('association_code', assoc).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('unit_occupancy').select('unit_ref, status').eq('association_code', assoc),
    supabaseAdmin.from('unit_tenant_contacts').select('unit_ref, tenant_name').eq('association_code', assoc),
  ])

  const occByAccount = new Map<string, UnitOption['occupancy']>((occ ?? []).map(o => [String(o.unit_ref), o.status as UnitOption['occupancy']]))
  const tenantByAccount = new Map<string, string>()
  for (const t of tenants ?? []) {
    const name = (t.tenant_name as string | null)?.trim()
    if (name) tenantByAccount.set(String(t.unit_ref), name)
  }

  const byAccount = new Map<string, UnitOption>()
  for (const o of owners ?? []) {
    const account = String(o.account_number ?? '').trim()
    const unit = String(o.unit_number ?? '').trim()
    if (!account || !unit) continue // skip non-unit CINC accounts (e.g. "Manager")
    const name = String(o.entity_name ?? '').trim() || [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
    const existing = byAccount.get(account)
    if (existing) { if (name && !existing.ownerName?.includes(name)) existing.ownerName = existing.ownerName ? `${existing.ownerName} & ${name}` : name; continue }

    const explicit = occByAccount.get(account) ?? null
    const tenantName = tenantByAccount.get(account) ?? null
    byAccount.set(account, {
      unit, accountNumber: account, ownerName: name || null,
      occupancy: explicit ?? (tenantName ? 'leased' : null),
      occupancyKnown: !!explicit,
      tenantName,
    })
  }

  const units = [...byAccount.values()].sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true }))
  return NextResponse.json({ units })
}
