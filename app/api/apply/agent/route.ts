// =====================================================================
// POST /api/apply/agent  (multipart)
//
// Applicant's-agent entry: uploads the lease / purchase agreement and tags
// every applicant (name/email/phone). Creates a listing_application under the
// unit's listing, records the agent + applicant stakeholders + the agreement,
// and grants the agent + applicants access to the financials. Public.
// =====================================================================

import { NextResponse } from 'next/server'
import {
  findOrCreateListing, createApplication, addStakeholder, attachDocument,
  uploadApplicationFile, grantFinancialsToStakeholder, type DocumentKind,
} from '@/lib/applications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ApplicantInput { name?: string; email?: string; phone?: string }

export async function POST(req: Request) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const s = (k: string) => String(form.get(k) ?? '').trim()

  const assoc        = s('assoc').toUpperCase()
  const unit         = s('unit')
  const agreementKind = (s('agreementKind') || 'lease') as DocumentKind  // 'lease' | 'purchase_agreement'
  const agentName    = s('agentName')
  const agentEmail   = s('agentEmail')
  const agentPhone   = s('agentPhone')
  const file         = form.get('agreement')
  let applicants: ApplicantInput[] = []
  try { applicants = JSON.parse(s('applicants') || '[]') } catch { applicants = [] }
  applicants = applicants.filter(a => (a.name || a.email || a.phone))

  if (!assoc || !unit) return NextResponse.json({ error: 'Association and unit are required.' }, { status: 400 })
  if (!agentName || !agentEmail) return NextResponse.json({ error: 'Your name and email are required.' }, { status: 400 })
  if (!applicants.length) return NextResponse.json({ error: 'Add at least one applicant.' }, { status: 400 })
  const listingType = agreementKind === 'purchase_agreement' ? 'sale' : 'rent'

  try {
    const listing = await findOrCreateListing({ assocCode: assoc, unitLabel: unit, listingType, createdByRole: 'applicant_agent' })
    const app     = await createApplication({ listingId: listing.id, createdByRole: 'applicant_agent' })

    const agent = await addStakeholder({ applicationId: app.id, role: 'applicant_agent', name: agentName, email: agentEmail, phone: agentPhone, isPrimary: true, addedByRole: 'applicant_agent', status: 'completed' })
    const applicantRows = []
    for (const a of applicants) {
      applicantRows.push(await addStakeholder({ applicationId: app.id, role: 'applicant', name: a.name ?? null, email: a.email ?? null, phone: a.phone ?? null, addedByRole: 'applicant_agent' }))
    }

    if (file instanceof File && file.size > 0) {
      const up = await uploadApplicationFile(file, { assocCode: assoc, scopeId: app.id, kind: agreementKind })
      await attachDocument({ applicationId: app.id, stakeholderId: agent.id, kind: agreementKind, ...up, uploadedByRole: 'applicant_agent' })
    }

    // All registered parties get the financials.
    await grantFinancialsToStakeholder(agent)
    for (const r of applicantRows) await grantFinancialsToStakeholder(r)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[apply/agent]', e)
    return NextResponse.json({ error: 'Something went wrong saving the application.' }, { status: 500 })
  }
}
