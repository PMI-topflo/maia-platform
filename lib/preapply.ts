// =====================================================================
// lib/preapply.ts
//
// Server helpers for the public Pre-Application Compliance intake (B4 slice 2).
// Builds on the existing collaborative-leasing foundation: one intake = a
// unit_listings row + a listing_applications row + the applicant
// application_stakeholders row; uploaded documents are application_documents
// tagged with the intake checklist item (doc_key). No new tables.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ApplicationType, ProvidedBy } from '@/lib/intake-documents'

export const INTAKE_BUCKET = 'application-docs'

export interface IntakeApplicant { name: string; email: string; phone?: string | null }

export interface CreatedIntake { applicationId: string; listingId: string }

/** Create a new intake: listing + application + applicant stakeholder. */
export async function createIntake(input: {
  associationCode: string; type: ApplicationType; role: string; unitLabel: string | null; applicant: IntakeApplicant
}): Promise<CreatedIntake | { error: string }> {
  const assoc = input.associationCode.toUpperCase()
  const { data: listing, error: le } = await supabaseAdmin.from('unit_listings').insert({
    association_code: assoc, unit_label: input.unitLabel,
    listing_type: input.type === 'purchase' ? 'sale' : 'rent', status: 'open', created_by_role: input.role,
  }).select('id').single()
  if (le || !listing) return { error: `Could not start: ${le?.message ?? 'unknown'}` }

  const { data: app, error: ae } = await supabaseAdmin.from('listing_applications').insert({
    listing_id: listing.id, status: 'started', application_type: input.type, applicant_role: input.role,
    association_code: assoc, unit_label: input.unitLabel, created_by_role: input.role,
  }).select('id').single()
  if (ae || !app) return { error: `Could not start: ${ae?.message ?? 'unknown'}` }

  await supabaseAdmin.from('application_stakeholders').insert({
    application_id: app.id, role: 'applicant', name: input.applicant.name,
    email: input.applicant.email, phone: input.applicant.phone ?? null,
    is_primary: true, status: 'started', added_by_role: input.role, started_at: new Date().toISOString(),
  })

  return { applicationId: app.id, listingId: listing.id }
}

export interface IntakeState {
  applicationId: string
  listingId: string
  associationCode: string
  type: ApplicationType
  role: string
  unitLabel: string | null
  status: string
  submittedAt: string | null
  emailVerifiedAt: string | null
  applicant: { name: string | null; email: string | null; phone: string | null } | null
  docs: { doc_key: string | null; doc_label: string | null; filename: string; created_at: string }[]
}

/** Stamp the applicant's email as verified (OTP passed). */
export async function markEmailVerified(applicationId: string): Promise<void> {
  await supabaseAdmin.from('listing_applications').update({ email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', applicationId)
}

export async function getIntake(applicationId: string): Promise<IntakeState | null> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, application_type, applicant_role, unit_label, status, submitted_at, email_verified_at')
    .eq('id', applicationId).maybeSingle()
  if (!app) return null
  const [{ data: sh }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', applicationId).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('application_documents').select('doc_key, doc_label, filename, created_at').eq('application_id', applicationId).order('created_at', { ascending: true }),
  ])
  return {
    applicationId: app.id, listingId: app.listing_id, associationCode: String(app.association_code),
    type: app.application_type as ApplicationType, role: String(app.applicant_role ?? 'applicant'),
    unitLabel: (app.unit_label as string | null) ?? null, status: String(app.status), submittedAt: (app.submitted_at as string | null) ?? null,
    emailVerifiedAt: (app.email_verified_at as string | null) ?? null,
    applicant: sh ? { name: sh.name as string | null, email: sh.email as string | null, phone: sh.phone as string | null } : null,
    docs: (docs ?? []) as IntakeState['docs'],
  }
}

/** Record an uploaded intake document against its checklist item. */
export async function recordIntakeDoc(applicationId: string, doc: { doc_key: string; doc_label: string; provided_by?: ProvidedBy; storage_path: string; filename: string; mime_type: string | null }): Promise<{ ok: boolean; error?: string }> {
  const { data: app } = await supabaseAdmin.from('listing_applications').select('listing_id').eq('id', applicationId).maybeSingle()
  if (!app) return { ok: false, error: 'not found' }
  // Replace any prior upload for the same checklist item (latest wins).
  await supabaseAdmin.from('application_documents').delete().eq('application_id', applicationId).eq('doc_key', doc.doc_key)
  const { error } = await supabaseAdmin.from('application_documents').insert({
    application_id: applicationId, listing_id: app.listing_id, kind: 'other',
    doc_key: doc.doc_key, doc_label: doc.doc_label, storage_path: doc.storage_path,
    filename: doc.filename, mime_type: doc.mime_type, uploaded_by_role: 'applicant',
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Finalize the intake: store the shown-&-signed rules acknowledgment + mark it
 *  submitted so it enters the staff audit queue. */
export async function submitIntake(applicationId: string, rulesAck: { name: string; signature: string | null; ip: string | null }): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('listing_applications').update({
    status: 'submitted', submitted_at: now, completed_at: now,
    rules_ack: { name: rulesAck.name, signature: rulesAck.signature, ip: rulesAck.ip, at: now },
    updated_at: now,
  }).eq('id', applicationId)
  return error ? { ok: false, error: error.message } : { ok: true }
}
