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
  const name  = String(body.name ?? '').trim()
  const phone = String(body.phone ?? '').trim()
  const email = String(body.email ?? '').trim()
  if (!name) return NextResponse.json({ error: "Enter the tenant's name." }, { status: 400 })
  if (!phone && !email) return NextResponse.json({ error: 'Enter a tenant phone or email.' }, { status: 400 })

  await supabaseAdmin.from('unit_tenant_contacts').upsert({
    association_code: t.assoc, unit_ref: t.account,
    tenant_name: name, tenant_phone: phone || null, tenant_email: email || null,
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
