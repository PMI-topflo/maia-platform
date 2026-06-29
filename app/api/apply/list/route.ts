// =====================================================================
// POST /api/apply/list  (multipart)
//
// Listing-agent entry: lists a unit for rent/sale, presents the listing
// agreement, tags the owner. Creates/finds the listing, records the listing
// agent + owner stakeholders + the listing agreement, notifies the owner to
// validate, and grants the agent access to the financials. Public (no login).
// =====================================================================

import { NextResponse } from 'next/server'
import {
  findOrCreateListing, addStakeholder, attachDocument, uploadApplicationFile,
  notifyOwnerOfListing, grantFinancialsToStakeholder, type ListingType,
} from '@/lib/applications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const s = (k: string) => String(form.get(k) ?? '').trim()

  const assoc       = s('assoc').toUpperCase()
  const unit        = s('unit')
  const listingType = s('listingType') as ListingType
  const agentName   = s('agentName')
  const agentEmail  = s('agentEmail')
  const agentPhone  = s('agentPhone')
  const ownerName   = s('ownerName')
  const ownerEmail  = s('ownerEmail')
  const file        = form.get('agreement')

  if (!assoc || !unit) return NextResponse.json({ error: 'Association and unit are required.' }, { status: 400 })
  if (listingType !== 'rent' && listingType !== 'sale') return NextResponse.json({ error: 'Choose rent or sale.' }, { status: 400 })
  if (!agentName || !agentEmail) return NextResponse.json({ error: 'Your name and email are required.' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Please attach the listing agreement.' }, { status: 400 })

  try {
    const listing = await findOrCreateListing({ assocCode: assoc, unitLabel: unit, listingType, createdByRole: 'listing_agent' })

    const agent = await addStakeholder({ listingId: listing.id, role: 'listing_agent', name: agentName, email: agentEmail, phone: agentPhone, isPrimary: true, addedByRole: 'listing_agent', status: 'completed' })
    const owner = await addStakeholder({ listingId: listing.id, role: 'owner', name: ownerName || null, email: ownerEmail || null, addedByRole: 'listing_agent' })

    const up = await uploadApplicationFile(file, { assocCode: assoc, scopeId: listing.id, kind: 'listing_agreement' })
    await attachDocument({ listingId: listing.id, stakeholderId: agent.id, kind: 'listing_agreement', ...up, uploadedByRole: 'listing_agent' })

    await notifyOwnerOfListing(listing, owner)
    await grantFinancialsToStakeholder(agent)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[apply/list]', e)
    return NextResponse.json({ error: 'Something went wrong saving the listing.' }, { status: 500 })
  }
}
