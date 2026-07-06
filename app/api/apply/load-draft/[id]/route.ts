// =====================================================================
// /api/apply/load-draft/[id]
//
// Returns the saved draft state for an applications row so the form
// can rehydrate when the applicant resumes from an emailed link.
//
// Public — the row id IS the resume token. We don't return any data
// staff entered (board_decision, screening_status, etc.); only the
// applicant-facing fields the form itself wrote.
//
// Returns null when the row doesn't exist (typo in URL) so the form
// can fall back to starting fresh instead of erroring.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SAFE_RETURN_FIELDS = `
  id, association, app_type, draft_step, draft_data,
  applicants, entity_name, sunbiz_id, principals, occupants,
  is_married_couple, couple_has_cert, language,
  resume_email,
  docs_lease_url, docs_gov_id_url, docs_proof_income_url, docs_marriage_cert_url,
  docs_intl_police_clearance_url, docs_intl_cpa_certification_url, docs_intl_translation_url,
  rules_signature, rules_agreed_at, acknowledged_document_ids,
  rules_signature_image, rules_applicant_photo, rules_signed_geolocation,
  stripe_payment_status
`.replace(/\s+/g, ' ').trim()

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('applications')
    .select(SAFE_RETURN_FIELDS)
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ draft: null })

  // Supabase TS narrows the .select() result to a string-error union
  // when it can't infer the row type; cast through unknown to read
  // the field we just selected.
  const row = data as unknown as { stripe_payment_status?: string | null }

  // If the application is already paid + submitted, don't let the form
  // resume into it (would let the applicant overwrite their own
  // submitted data). Treat as "no draft to resume".
  if (row.stripe_payment_status === 'succeeded' || row.stripe_payment_status === 'paid') {
    return NextResponse.json({ draft: null, submitted: true })
  }

  return NextResponse.json({ draft: data })
}
