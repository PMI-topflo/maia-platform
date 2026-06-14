// =====================================================================
// /api/renter/compliance/[token]   (token-gated; no session)
// GET  → the tenant's unit, their contact on file, and the documents we
//        still need from them (HO-4 renters insurance, registrations, etc.).
// POST → { name, phone, email } save/confirm the tenant's own contact.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyTenantComplianceToken } from '@/lib/owner-portal-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTenantComplianceState } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ctxOf(token: string) {
  const t = await verifyTenantComplianceToken(token)
  if (!t) return null
  const { data: o } = await supabaseAdmin.from('owners')
    .select('unit_number, association_name').eq('association_code', t.assoc).eq('account_number', t.account).maybeSingle()
  return { assoc: t.assoc, account: t.account, unit: (o?.unit_number as string | null) ?? null, associationName: (o?.association_name as string | null) ?? t.assoc }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cx = await ctxOf(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })
  const { data: tc } = await supabaseAdmin.from('unit_tenant_contacts')
    .select('tenant_name, tenant_phone, tenant_email').eq('association_code', cx.assoc).eq('unit_ref', cx.account).maybeSingle()
  const { missing, commercial } = await getTenantComplianceState(cx.assoc, cx.account)
  return NextResponse.json({
    associationName: cx.associationName, unit: cx.unit, missing, commercial,
    contact: { name: tc?.tenant_name ?? '', phone: tc?.tenant_phone ?? '', email: tc?.tenant_email ?? '' },
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cx = await ctxOf(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const name = String(body.name ?? '').trim()
  const phone = String(body.phone ?? '').trim()
  const email = String(body.email ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Enter your name.' }, { status: 400 })
  if (!phone && !email) return NextResponse.json({ error: 'Enter a phone or email.' }, { status: 400 })

  await supabaseAdmin.from('unit_tenant_contacts').upsert({
    association_code: cx.assoc, unit_ref: cx.account,
    tenant_name: name, tenant_phone: phone || null, tenant_email: email || null,
    updated_by: 'tenant', updated_at: new Date().toISOString(),
  }, { onConflict: 'association_code,unit_ref' })
  await supabaseAdmin.from('compliance_records').upsert({
    scope: 'unit', association_code: cx.assoc, unit_ref: cx.account, item_key: 'unit.tenant',
    applicable: true, status: 'current', updated_by: 'tenant',
  }, { onConflict: 'scope,association_code,unit_ref,item_key' }).then(() => null, () => null)

  const { missing } = await getTenantComplianceState(cx.assoc, cx.account)
  return NextResponse.json({ ok: true, missing })
}
