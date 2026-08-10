// =====================================================================
// lib/intake-documents.ts
//
// Per-application-type document checklist for the Pre-Application Compliance
// intake (B4). Reads association_intake_documents — the config that says, for
// a given association + application type, exactly which documents each party
// must provide. Drives the public intake checklist, the staff audit view, and
// (later) what populates MAIA + Checkr.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { INTAKE_BUCKET } from '@/lib/preapply'

export type ApplicationType = 'lease' | 'purchase' | 'additional_occupant' | 'lease_renewal' | 'ownership_transfer' | 'occupancy_registration'
export type ProvidedBy = 'applicant' | 'landlord' | 'agent'

export const APPLICATION_TYPES: { key: ApplicationType; label: string; blurb: string }[] = [
  { key: 'lease',               label: 'Lease / Rental',       blurb: 'A tenant renting the unit' },
  { key: 'purchase',            label: 'Purchase',             blurb: 'A buyer purchasing the unit' },
  { key: 'lease_renewal',       label: 'Lease Renewal',        blurb: 'An existing tenant renewing' },
  { key: 'additional_occupant', label: 'Additional Occupant',  blurb: 'Adding an occupant to an existing lease' },
  { key: 'ownership_transfer',  label: 'Ownership Transfer',   blurb: 'Transferring ownership of the unit' },
  { key: 'occupancy_registration', label: 'Occupancy Registration', blurb: 'Registering who occupies the unit' },
]
export const PROVIDED_BY_LABEL: Record<ProvidedBy, string> = { applicant: 'Applicant', landlord: 'Landlord / Owner', agent: 'Agent' }

const APP_TYPE_KEYS = new Set<string>(APPLICATION_TYPES.map(t => t.key))
export function isApplicationType(v: string): v is ApplicationType {
  return APP_TYPE_KEYS.has(v)
}

export interface IntakeDoc {
  id: string
  doc_key: string
  label: string
  provided_by: ProvidedBy
  required: boolean
  note: string | null
  sort_order: number
  template_path: string | null
  requires_notarization: boolean
  per_applicant: boolean
}

/** Signed preview links for the example-form templates, keyed by template_path.
 *  Lets reviewers open an example of each form that has one on file. */
export async function signTemplateUrls(docs: { template_path: string | null }[]): Promise<Map<string, string>> {
  const paths = [...new Set(docs.map(d => d.template_path).filter((p): p is string => !!p))]
  const out = new Map<string, string>()
  await Promise.all(paths.map(async p => {
    const { data } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUrl(p, 60 * 60 * 4)
    if (data?.signedUrl) out.set(p, data.signedUrl)
  }))
  return out
}

/** The active document checklist for an association + application type, ordered. */
export async function getIntakeChecklist(associationCode: string, type: ApplicationType): Promise<IntakeDoc[]> {
  const { data } = await supabaseAdmin.from('association_intake_documents')
    .select('id, doc_key, label, provided_by, required, note, sort_order, template_path, requires_notarization, per_applicant')
    .eq('association_code', associationCode.toUpperCase())
    .eq('application_type', type)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  return (data ?? []) as IntakeDoc[]
}

/** The whole checklist for an association, grouped by type (admin view). */
export async function getIntakeChecklistAll(associationCode: string): Promise<Record<ApplicationType, IntakeDoc[]>> {
  const { data } = await supabaseAdmin.from('association_intake_documents')
    .select('id, application_type, doc_key, label, provided_by, required, note, sort_order, template_path, requires_notarization, per_applicant')
    .eq('association_code', associationCode.toUpperCase())
    .eq('active', true)
    .order('sort_order', { ascending: true })
  const out: Record<ApplicationType, IntakeDoc[]> = { lease: [], purchase: [], additional_occupant: [], lease_renewal: [], ownership_transfer: [], occupancy_registration: [] }
  for (const r of (data ?? []) as (IntakeDoc & { application_type: ApplicationType })[]) {
    if (isApplicationType(r.application_type)) out[r.application_type].push(r)
  }
  return out
}
