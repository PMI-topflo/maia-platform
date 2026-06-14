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
import { getUnitComplianceState, setUnitOccupancy, OCCUPANCY_LABEL, type Occupancy } from '@/lib/unit-required-docs'

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
  const { occupancy, missing } = await getUnitComplianceState(cx.assoc, cx.account)
  return NextResponse.json({
    ownerName: cx.ownerName, unit: cx.unit, associationName: cx.associationName,
    occupancy, occupancyLabel: occupancy ? OCCUPANCY_LABEL[occupancy] : null, missing,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cx = await ownerContext(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const status = body.status as Occupancy
  if (!['owner_occupied', 'leased', 'vacant'].includes(status)) return NextResponse.json({ error: 'pick owner-occupied, leased, or vacant' }, { status: 400 })

  await setUnitOccupancy(cx.assoc, cx.account, status, 'owner')
  const { missing } = await getUnitComplianceState(cx.assoc, cx.account)
  return NextResponse.json({ ok: true, occupancy: status, missing })
}
