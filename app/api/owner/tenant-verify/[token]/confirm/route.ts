// =====================================================================
// POST /api/owner/tenant-verify/[token]/confirm   { confirmed: boolean }
// (token-gated; no session)
// The owner confirms or disputes that the self-identified person is their
// tenant. Confirming recomputes readiness; disputing marks the verification
// rejected and alerts staff — a self-identified tenant the owner disavows
// must not proceed toward association_tenants.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyTenantVerifyToken } from '@/lib/tenant-verification-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { fetchStaffList } from '@/lib/staff-list'
import { computeStatus, type TenantVerificationRow } from '@/lib/tenant-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const verificationId = await verifyTenantVerifyToken(token)
  if (!verificationId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: { confirmed?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (typeof body.confirmed !== 'boolean') return NextResponse.json({ error: 'confirmed must be a boolean' }, { status: 400 })

  const { data: v } = await supabaseAdmin.from('tenant_verifications')
    .select('id, association_name, unit_number, tenant_name, lease_path, lease_source, board_letter_path, board_letter_source, owner_confirmed, status')
    .eq('id', verificationId).maybeSingle()
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (!body.confirmed) {
    await supabaseAdmin.from('tenant_verifications').update({
      status: 'rejected', owner_confirmed: false, updated_at: new Date().toISOString(),
    }).eq('id', verificationId)

    const staff = await fetchStaffList()
    if (staff.length > 0) {
      await sendEmail({
        to: staff.map(s => s.email),
        subject: `Owner disputes tenant claim — ${v.association_name ?? ''} unit ${v.unit_number ?? ''}`,
        html: `<p><strong>${v.tenant_name ?? 'Someone'}</strong> self-identified as the tenant of unit ${v.unit_number ?? '—'} at ${v.association_name ?? '—'}, but the owner of record says this is NOT their tenant. Please follow up.</p>`,
      }).catch(() => null)
    }
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  const row = v as unknown as TenantVerificationRow
  const nextRow: TenantVerificationRow = { ...row, owner_confirmed: true }
  const status = computeStatus(nextRow)
  await supabaseAdmin.from('tenant_verifications').update({
    owner_confirmed: true, owner_confirmed_at: new Date().toISOString(), status, updated_at: new Date().toISOString(),
  }).eq('id', verificationId)

  return NextResponse.json({ ok: true, status })
}
