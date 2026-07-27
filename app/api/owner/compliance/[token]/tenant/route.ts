// =====================================================================
// POST /api/owner/compliance/[token]/tenant  (token-gated; no session)
// The owner of a LEASED unit provides their tenant's contact info (name,
// phone, email + lease dates). Stored for mass communication + leasing
// compliance, and marks the unit's Tenant item as on file. Returns the
// recomputed missing list.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyOwnerComplianceToken } from '@/lib/owner-portal-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUnitComplianceState } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const dateOrNull = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyOwnerComplianceToken(token)
  if (!t) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // Accept either a single tenant ({name,phone,email}) or a list of occupants
  // ({occupants:[{name,phone,email}]}). The first occupant is the primary
  // tenant (kept in the tenant_* columns for back-compat); the full list is
  // stored in occupants.
  const rawList = Array.isArray(body.occupants) && body.occupants.length
    ? (body.occupants as Record<string, unknown>[])
    : [{ name: body.name, phone: body.phone, email: body.email }]
  const occupants = rawList
    .map(o => ({ name: String(o.name ?? '').trim(), phone: String(o.phone ?? '').trim(), email: String(o.email ?? '').trim() }))
    .filter(o => o.name || o.phone || o.email)
  const primary = occupants[0]
  if (!primary || !primary.name) return NextResponse.json({ error: "Enter the tenant's name." }, { status: 400 })
  if (!primary.phone && !primary.email) return NextResponse.json({ error: 'Enter a tenant phone or email.' }, { status: 400 })

  await supabaseAdmin.from('unit_tenant_contacts').upsert({
    association_code: t.assoc, unit_ref: t.account,
    tenant_name: primary.name, tenant_phone: primary.phone || null, tenant_email: primary.email || null,
    occupants,
    lease_start: dateOrNull(body.leaseStart), lease_end: dateOrNull(body.leaseEnd),
    updated_by: 'owner', updated_at: new Date().toISOString(),
  }, { onConflict: 'association_code,unit_ref' })

  // Tenant contact is now on file → mark the unit's Tenant item satisfied.
  await supabaseAdmin.from('compliance_records').upsert({
    scope: 'unit', association_code: t.assoc, unit_ref: t.account, item_key: 'unit.tenant',
    applicable: true, status: 'current', updated_by: 'owner',
  }, { onConflict: 'scope,association_code,unit_ref,item_key' }).then(() => null, () => null)

  const { missing } = await getUnitComplianceState(t.assoc, t.account)
  return NextResponse.json({ ok: true, missing })
}
