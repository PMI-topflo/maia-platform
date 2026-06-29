// =====================================================================
// GET /api/applications/financials/[token]
//
// A registered application stakeholder (applicant, agent, owner) exchanges
// their secure token for this association's gated budget / financial / lease
// documents — the categories hidden from the open public page. Token-gated,
// no login. The nonce in the token must still match the stakeholder row, so
// access can be revoked by rotating the nonce.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyApplicationToken } from '@/lib/application-token'
import { financialsForAssociation } from '@/lib/applications'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyApplicationToken(token)
  if (!data) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  const { data: s } = await supabaseAdmin.from('application_stakeholders')
    .select('id, token_nonce, listing_id, application_id, name')
    .eq('id', data.stakeholderId).maybeSingle()
  if (!s || s.token_nonce !== data.nonce) {
    return NextResponse.json({ error: 'This link is no longer active.' }, { status: 401 })
  }

  // Resolve the association from the stakeholder's listing (directly or via app).
  let listingId = s.listing_id as string | null
  if (!listingId && s.application_id) {
    const { data: app } = await supabaseAdmin.from('applications')
      .select('listing_id').eq('id', s.application_id).maybeSingle()
    listingId = (app?.listing_id as string) ?? null
  }
  if (!listingId) return NextResponse.json({ error: 'No association on file.' }, { status: 404 })

  const { data: listing } = await supabaseAdmin.from('unit_listings')
    .select('association_code, unit_label, account_number').eq('id', listingId).maybeSingle()
  if (!listing) return NextResponse.json({ error: 'No association on file.' }, { status: 404 })

  const groups = await financialsForAssociation(String(listing.association_code))
  return NextResponse.json({
    ok: true,
    association_code: listing.association_code,
    unit: listing.unit_label ?? listing.account_number ?? null,
    name: s.name ?? null,
    groups,
  })
}
