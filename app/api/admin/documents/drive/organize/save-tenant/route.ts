// POST /api/admin/documents/drive/organize/save-tenant
//   { associationCode, unitRef, tenantName, leaseStart?, leaseEnd? }
// Save what MAIA read from a lease into the unit's tenant record
// (unit_tenant_contacts) — the same record the owner/manager compliance flow
// writes, so it surfaces on the /units unit page for staff to confirm.
// Staff-only. (Owners/buyers are NOT written here — handled by their own flow.)

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { associationCode?: string; unitRef?: string; tenantName?: string; leaseStart?: string; leaseEnd?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const association = String(body.associationCode ?? '').trim().toUpperCase()
  const unitRef = String(body.unitRef ?? '').trim()
  const tenantName = String(body.tenantName ?? '').trim() || null
  const leaseStart = body.leaseStart ? String(body.leaseStart).trim() : null
  const leaseEnd = body.leaseEnd ? String(body.leaseEnd).trim() : null
  if (!association || !unitRef) return NextResponse.json({ error: 'associationCode and unitRef required' }, { status: 400 })
  if (!tenantName && !leaseStart && !leaseEnd) return NextResponse.json({ error: 'nothing to save' }, { status: 400 })

  const { error } = await supabaseAdmin.from('unit_tenant_contacts').upsert({
    association_code: association, unit_ref: unitRef,
    tenant_name: tenantName, lease_start: leaseStart, lease_end: leaseEnd,
    updated_by: `staff:${session.displayName} (from lease)`,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'association_code,unit_ref' })
  if (error) return NextResponse.json({ error: `Could not save: ${error.message}` }, { status: 200 })

  // The board Approval Letter is valid for the tenancy it approved, so its
  // expiry tracks the lease end. If we just learned a lease end and an approval
  // letter is already on file for this unit, keep the two in sync.
  if (leaseEnd) {
    const d = new Date(leaseEnd), now = new Date()
    const status = d < now || (d.getTime() - now.getTime()) / 86_400_000 <= 45 ? 'expiring' : 'current'
    await supabaseAdmin.from('compliance_records')
      .update({ expiry_date: leaseEnd, status, updated_at: new Date().toISOString() })
      .eq('scope', 'unit').eq('association_code', association).eq('unit_ref', unitRef)
      .eq('item_key', 'unit.approval_letter')
      .then(() => null, () => null)
  }

  return NextResponse.json({ ok: true })
}
