// =====================================================================
// /api/apply/save-draft
//
// Persists partial apply-form state so applicants can leave and come
// back. Called by the form on every step transition (and on form
// blur, if we add that later). Writes the per-field columns the
// applications table already has + a flexible draft_data JSONB bag
// for everything UI-level that doesn't map to a column.
//
// Public — no session. The id (applications.id) is the
// authentication: the applicant has it from the URL we emailed them.
// Anti-tampering is the same as record-signature-evidence: we ONLY
// allow writes to the draft + applicant fields. Status, payment,
// board_decision, and similar gating fields are NEVER patched here.
//
// Body shape:
//   {
//     applicationId?: string         // optional — create if missing
//     association?:   string
//     app_type?:      string
//     draft_step?:    number
//     draft_data?:    jsonb
//     applicants?:    Applicant[]
//     entity_name?:   string | null
//     sunbiz_id?:     string | null
//     principals?:    Principal[]
//     occupants?:     Occupant[]
//     is_married_couple?: boolean | null
//     couple_has_cert?:   boolean | null
//     resume_email?:  string | null
//   }
//
// Returns: { applicationId }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SAFE_FIELDS = [
  'association',
  'app_type',
  'draft_step',
  'draft_data',
  'applicants',
  'entity_name',
  'sunbiz_id',
  'principals',
  'occupants',
  'is_married_couple',
  'couple_has_cert',
  'language',
  'resume_email',
] as const

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  for (const key of SAFE_FIELDS) {
    if (key in body) patch[key] = body[key]
  }

  const existingId = typeof body.applicationId === 'string' ? body.applicationId : null

  if (existingId) {
    // Update existing draft. Don't whine if the row is gone — the
    // form will retry on next step transition or fall back to insert.
    const { error } = await supabaseAdmin
      .from('applications')
      .update(patch)
      .eq('id', existingId)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ applicationId: existingId })
  }

  // First save — create the row. Fill in the absolute-minimum required
  // fields so the existing schema constraints are satisfied.
  const insertRow: Record<string, unknown> = {
    ...patch,
    association:           patch.association          ?? 'pending',
    app_type:              patch.app_type             ?? 'pending',
    total_charged:         0,
    stripe_payment_status: 'pending',
  }

  const { data, error } = await supabaseAdmin
    .from('applications')
    .insert(insertRow)
    .select('id')
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ applicationId: data.id })
}
