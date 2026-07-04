// =====================================================================
// /api/owner/compliance/[token]   (token-gated; no session)
// GET  → the owner's unit, current occupancy, and the documents still
//        missing for their occupancy type.
// POST → { status } save occupancy (owner_occupied|leased|vacant); returns
//        the recomputed missing list (it changes with occupancy).
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyOwnerComplianceToken } from '@/lib/owner-portal-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUnitComplianceState, setUnitOccupancy, setCommercialUseType, OCCUPANCY_LABEL, type Occupancy } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownerContext(token: string) {
  const t = await verifyOwnerComplianceToken(token)
  if (!t) return null
  const { data: o } = await supabaseAdmin.from('owners')
    .select('first_name, last_name, unit_number, association_name')
    .eq('association_code', t.assoc).eq('account_number', t.account).maybeSingle()
  const ownerName = [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim() || null
  return { assoc: t.assoc, account: t.account, ownerName, unit: (o?.unit_number as string | null) ?? null, associationName: (o?.association_name as string | null) ?? t.assoc }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cx = await ownerContext(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  // Record the first click (owner opened their link from the email) — used by
  // the staff Compliance Outreach page. Fire-and-forget; never blocks the page.
  void (async () => {
    const { data: r } = await supabaseAdmin.from('owner_compliance_requests')
      .select('id, opened_at').eq('association_code', cx.assoc).eq('unit_ref', cx.account).maybeSingle()
    if (r) { if (!r.opened_at) await supabaseAdmin.from('owner_compliance_requests').update({ opened_at: new Date().toISOString() }).eq('id', r.id) }
    else await supabaseAdmin.from('owner_compliance_requests').insert({ association_code: cx.assoc, unit_ref: cx.account, opened_at: new Date().toISOString() })
  })().catch(() => null)

  const { occupancy, kind, commercialUseType, missing } = await getUnitComplianceState(cx.assoc, cx.account)
  return NextResponse.json({
    ownerName: cx.ownerName, unit: cx.unit, associationName: cx.associationName,
    occupancy, occupancyLabel: occupancy ? OCCUPANCY_LABEL[occupancy] : null, kind, commercialUseType, missing,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cx = await ownerContext(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: { status?: string; commercialUseType?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  if (body.commercialUseType !== undefined) {
    const saved = await setCommercialUseType(cx.assoc, cx.account, body.commercialUseType, 'owner')
    if (!saved) return NextResponse.json({ error: 'Please pick how the unit is used above first.' }, { status: 409 })
    const { missing } = await getUnitComplianceState(cx.assoc, cx.account)
    return NextResponse.json({ ok: true, commercialUseType: body.commercialUseType, missing })
  }

  const status = body.status as Occupancy
  if (!['owner_occupied', 'leased', 'vacant'].includes(status)) return NextResponse.json({ error: 'pick owner-occupied, leased, or vacant' }, { status: 400 })

  await setUnitOccupancy(cx.assoc, cx.account, status, 'owner')
  const { missing } = await getUnitComplianceState(cx.assoc, cx.account)
  return NextResponse.json({ ok: true, occupancy: status, missing })
}
