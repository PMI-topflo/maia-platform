// =====================================================================
// /api/apply/owner-validate/[token]
//   GET  — owner's listing + pre-filled occupancy (from association_tenants).
//   POST — owner confirms vacancy / prior-tenant-moved-out → saves to the
//          listing + grants the owner access to the financials.
// Token-gated (owner stakeholder), no login.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyApplicationToken } from '@/lib/application-token'
import { lookupUnitOccupancy, grantFinancialsToStakeholder, type Stakeholder } from '@/lib/applications'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolve(token: string) {
  const data = await verifyApplicationToken(token)
  if (!data) return null
  const { data: s } = await supabaseAdmin.from('application_stakeholders')
    .select('*').eq('id', data.stakeholderId).maybeSingle()
  if (!s || s.token_nonce !== data.nonce || s.role !== 'owner' || !s.listing_id) return null
  const { data: listing } = await supabaseAdmin.from('unit_listings')
    .select('*').eq('id', s.listing_id).maybeSingle()
  if (!listing) return null
  return { stakeholder: s as Stakeholder, listing }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const r = await resolve((await ctx.params).token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const pre = await lookupUnitOccupancy(String(r.listing.association_code), r.listing.unit_label)
  return NextResponse.json({
    ok: true,
    unit: r.listing.unit_label ?? r.listing.account_number ?? null,
    listing_type: r.listing.listing_type,
    already_validated: !!r.listing.owner_validated_at,
    prefill: { vacant: r.listing.unit_vacant ?? pre.vacant, prior_tenant: pre.priorTenant },
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const r = await resolve((await ctx.params).token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  let b: { unitVacant?: boolean; priorTenantMovedOut?: boolean | null }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const { error } = await supabaseAdmin.from('unit_listings').update({
    unit_vacant: typeof b.unitVacant === 'boolean' ? b.unitVacant : null,
    prior_tenant_moved_out: typeof b.priorTenantMovedOut === 'boolean' ? b.priorTenantMovedOut : null,
    owner_validated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', r.listing.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('application_stakeholders')
    .update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', r.stakeholder.id)
  await grantFinancialsToStakeholder(r.stakeholder)

  return NextResponse.json({ ok: true })
}
