// GET /api/admin/emergency-contacts/campaign/preview-email?assoc=CODE
//
// The email the campaign would send, rendered from the SAME builder that sends
// it (emergencyContactEmail) so a preview can never drift from the real thing.
//
// Both variants come back, because they are materially different letters: a
// resident is asked who lives in their unit, a non-resident owner is asked to
// check the tenants MAIA already holds. Staff approving a send to 149 people
// should see both.
//
// NOTHING IS CREATED AND NO TOKEN IS MINTED. The button in the preview is
// deliberately dead — a real signing link handed out from a shared admin
// screen is a link to somebody else's form. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { emergencyContactEmail, emergencyContactRecipients } from '@/lib/emergency-contact-campaign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = new URL(req.url).searchParams.get('assoc')
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })
  const code = assoc.toUpperCase()

  const [{ data: a }, { recipients }] = await Promise.all([
    supabaseAdmin.from('associations')
      .select('legal_name, association_name, principal_address, city, state, zip')
      .eq('association_code', code).maybeSingle(),
    emergencyContactRecipients(code),
  ])
  const legalName = (a?.legal_name as string | null) || (a?.association_name as string | null) || code
  const propertyAddress = [a?.principal_address, [a?.city, [a?.state, a?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
    .filter(Boolean).join(', ') || null

  // Show a REAL recipient of each kind where one exists, so staff see the
  // actual names and unit references that will go out — not "Jane Doe".
  const pick = (want: (r: typeof recipients[number]) => boolean) => recipients.find(want) ?? null
  const resident = pick(r => r.audience === 'resident')
  const landlordR = pick(r => r.audience === 'landlord')

  const DEAD_LINK = '#preview-only'
  const variant = (r: typeof recipients[number] | null, landlord: boolean) => {
    const mail = emergencyContactEmail({
      recipientName: r?.name ?? null, legalName, propertyAddress,
      unitRef: r?.unitRef ?? '000', landlord, link: DEAD_LINK,
    })
    return {
      ...mail,
      sampleOf: r ? { unitRef: r.unitRef, name: r.name, email: r.email, party: r.party } : null,
      count: recipients.filter(x => (x.audience === 'landlord') === landlord).length,
    }
  }

  return NextResponse.json({
    associationCode: code,
    associationName: legalName,
    total: recipients.length,
    variants: [
      { key: 'resident', title: 'Owner who lives in the unit, or a renter', ...variant(resident, false) },
      { key: 'landlord', title: 'Owner whose unit is rented out', ...variant(landlordR, true) },
    ],
  })
}
