// POST /api/admin/documents/drive/organize/file
//   { associationCode, unitRef, itemKey, scope?, expiry?, docType? }
// Save what MAIA read from a Drive file into a compliance record — so the
// expiration lands in the unit's audit (the /units Expired/Expiring blocks).
// Mirrors the units review-approve filing. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { unitLeaseEnd } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// compliance_records.status is constrained to current|expiring|pending|missing|
// non_compliant|na — 'expired' is NOT valid; an expired/soon date is stored as
// 'expiring' and the true state is derived from expiry_date at read time.
function statusFromExpiry(exp: string | null): string {
  if (!exp) return 'current'
  const d = new Date(exp), now = new Date()
  if (d < now) return 'expiring'
  return (d.getTime() - now.getTime()) / 86_400_000 <= 45 ? 'expiring' : 'current'
}

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { associationCode?: string; unitRef?: string; itemKey?: string; scope?: string; expiry?: string; docType?: string; driveUrl?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const association = String(body.associationCode ?? '').trim().toUpperCase()
  const unitRef = String(body.unitRef ?? '').trim()
  const itemKey = String(body.itemKey ?? '').trim()
  const scope = body.scope === 'association' ? 'association' : 'unit'
  let expiry = body.expiry ? String(body.expiry).trim() : null
  const driveUrl = body.driveUrl ? String(body.driveUrl).trim() : null   // link to the file, shown on the unit page
  if (!association || !itemKey) return NextResponse.json({ error: 'associationCode and itemKey required' }, { status: 400 })
  if (scope === 'unit' && !unitRef) return NextResponse.json({ error: 'unitRef required for a unit document' }, { status: 400 })

  // The board Approval Letter carries no expiry of its own — it's valid for the
  // tenancy it approved, so its expiry tracks the unit's lease end date.
  if (itemKey === 'unit.approval_letter') {
    const leaseEnd = await unitLeaseEnd(association, unitRef)
    if (leaseEnd) expiry = leaseEnd
  }

  const { error } = await supabaseAdmin.from('compliance_records').upsert({
    scope, association_code: association, unit_ref: scope === 'unit' ? unitRef : null,
    item_key: itemKey, applicable: true,
    status: statusFromExpiry(expiry), expiry_date: expiry,
    ...(driveUrl ? { drive_url: driveUrl } : {}),
    updated_by: `staff:${session.displayName} (drive-organize)`,
  }, { onConflict: 'scope,association_code,unit_ref,item_key' })
  if (error) return NextResponse.json({ error: `Could not file: ${error.message}` }, { status: 200 })

  return NextResponse.json({ ok: true })
}
