// =====================================================================
// POST /api/apply/applicant  (multipart)
//
// Applicant entry: uploads the lease / purchase agreement and (optionally)
// adds their own agent's info. Creates a listing_application, records the
// applicant (+ their agent) + the agreement, notifies the agent the applicant
// STARTED, and grants the applicant access to the financials. Public.
// =====================================================================

import { NextResponse } from 'next/server'
import {
  findOrCreateListing, createApplication, addStakeholder, attachDocument,
  uploadApplicationFile, grantFinancialsToStakeholder, notifyApplicantAgent, type DocumentKind,
} from '@/lib/applications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const s = (k: string) => String(form.get(k) ?? '').trim()

  const assoc          = s('assoc').toUpperCase()
  const unit           = s('unit')
  const agreementKind  = (s('agreementKind') || 'lease') as DocumentKind  // 'lease' | 'purchase_agreement'
  const applicantName  = s('applicantName')
  const applicantEmail = s('applicantEmail')
  const applicantPhone = s('applicantPhone')
  const agentName      = s('agentName')
  const agentEmail     = s('agentEmail')
  const agentPhone     = s('agentPhone')
  const file           = form.get('agreement')

  if (!assoc || !unit) return NextResponse.json({ error: 'Association and unit are required.' }, { status: 400 })
  if (!applicantName || !applicantEmail) return NextResponse.json({ error: 'Your name and email are required.' }, { status: 400 })
  const listingType = agreementKind === 'purchase_agreement' ? 'sale' : 'rent'

  try {
    const listing = await findOrCreateListing({ assocCode: assoc, unitLabel: unit, listingType, createdByRole: 'applicant' })
    const app     = await createApplication({ listingId: listing.id, createdByRole: 'applicant' })

    const applicant = await addStakeholder({ applicationId: app.id, role: 'applicant', name: applicantName, email: applicantEmail, phone: applicantPhone, isPrimary: true, addedByRole: 'applicant', status: 'started' })
    if (agentName || agentEmail) {
      await addStakeholder({ applicationId: app.id, role: 'applicant_agent', name: agentName || null, email: agentEmail || null, phone: agentPhone || null, addedByRole: 'applicant' })
    }

    if (file instanceof File && file.size > 0) {
      const up = await uploadApplicationFile(file, { assocCode: assoc, scopeId: app.id, kind: agreementKind })
      await attachDocument({ applicationId: app.id, stakeholderId: applicant.id, kind: agreementKind, ...up, uploadedByRole: 'applicant' })
    }

    await notifyApplicantAgent(app.id, 'started')
    await grantFinancialsToStakeholder(applicant)

    // Hand-off context so the done screen can continue into the full /apply wizard.
    return NextResponse.json({ ok: true, listingApplicationId: app.id, assoc, unit })
  } catch (e) {
    console.error('[apply/applicant]', e)
    return NextResponse.json({ error: 'Something went wrong saving your application.' }, { status: 500 })
  }
}
