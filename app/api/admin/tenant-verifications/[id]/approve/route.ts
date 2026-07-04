// =====================================================================
// POST /api/admin/tenant-verifications/[id]/approve   (staff-only)
// Validates the verification is actually ready (both docs on file AND
// (owner confirmed OR both docs staff-sourced)), then inserts the tenant
// into association_tenants — same side effects as the MAIA "new tenant"
// email-command insert (archive any existing active tenant for the unit,
// tenant_history audit rows) — and flips the unit's occupancy to 'leased'.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isReadyToApprove, type TenantVerificationRow } from '@/lib/tenant-verification'
import { setUnitOccupancy } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = typeof session.userId === 'string' ? session.userId : 'staff'

  const { id } = await ctx.params
  const { data: v } = await supabaseAdmin.from('tenant_verifications').select('*').eq('id', id).maybeSingle()
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (v.status === 'approved') return NextResponse.json({ error: 'already approved' }, { status: 409 })
  if (!v.association_code || !v.unit_number) return NextResponse.json({ error: 'Resolve the association + unit number first.' }, { status: 409 })
  if (!isReadyToApprove(v as unknown as TenantVerificationRow)) {
    return NextResponse.json({ error: 'Not ready — both documents and owner confirmation (or staff-sourced docs) are required.' }, { status: 409 })
  }

  const [first, ...rest] = (v.tenant_name ?? '').trim().split(/\s+/)
  const lastName = rest.join(' ')
  const today = new Date().toISOString().slice(0, 10)

  const { data: prevTenant } = await supabaseAdmin.from('association_tenants')
    .select('id, first_name, last_name')
    .eq('association_code', v.association_code).eq('unit_number', v.unit_number)
    .not('status', 'in', '("previous","expired")')
    .maybeSingle()

  if (prevTenant) {
    const prevName = [prevTenant.first_name, prevTenant.last_name].filter(Boolean).join(' ') || 'Previous Tenant'
    await supabaseAdmin.from('association_tenants').update({
      status: 'previous', lease_end_date: today, transferred_to: v.tenant_name,
    }).eq('id', prevTenant.id)
    void supabaseAdmin.from('tenant_history').insert({
      tenant_id: prevTenant.id, association_code: v.association_code, unit_number: v.unit_number,
      tenant_name: prevName, action: 'archived', reason: 'new_tenant_added', performed_by: 'maia',
    })
  }

  const { data: created, error } = await supabaseAdmin.from('association_tenants').insert({
    association_code: v.association_code, association_name: v.association_name, unit_number: v.unit_number,
    first_name: first || v.tenant_name, last_name: lastName, email: v.email, phone: v.phone,
    notes: 'Verified via pre-registration triage (lease + board-approval letter)',
    status: 'active', lease_start_date: v.lease_start_date ?? today,
    transferred_from: prevTenant ? [prevTenant.first_name, prevTenant.last_name].filter(Boolean).join(' ') : null,
    previous_tenant_id: prevTenant?.id ?? null, added_by: 'maia',
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  void supabaseAdmin.from('tenant_history').insert({
    tenant_id: created.id, association_code: v.association_code, unit_number: v.unit_number,
    tenant_name: v.tenant_name, action: 'added', performed_by: 'maia',
  })

  await setUnitOccupancy(v.association_code, v.unit_number, 'leased', 'maia')

  await supabaseAdmin.from('tenant_verifications').update({
    status: 'approved', updated_at: new Date().toISOString(),
  }).eq('id', id)

  if (v.pre_registration_id) {
    await supabaseAdmin.from('pre_registrations').update({
      status: 'added', handled_by: me, handled_at: new Date().toISOString(),
    }).eq('id', v.pre_registration_id)
  }

  return NextResponse.json({ ok: true, tenantId: created.id })
}
