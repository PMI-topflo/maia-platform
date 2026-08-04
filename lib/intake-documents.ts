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

export type ApplicationType = 'lease' | 'purchase' | 'additional_occupant' | 'lease_renewal'
export type ProvidedBy = 'applicant' | 'landlord' | 'agent'

export const APPLICATION_TYPES: { key: ApplicationType; label: string; blurb: string }[] = [
  { key: 'lease',               label: 'Lease / Rental',       blurb: 'A tenant renting the unit' },
  { key: 'purchase',            label: 'Purchase',             blurb: 'A buyer purchasing the unit' },
  { key: 'lease_renewal',       label: 'Lease Renewal',        blurb: 'An existing tenant renewing' },
  { key: 'additional_occupant', label: 'Additional Occupant',  blurb: 'Adding an occupant to an existing lease' },
]
export const PROVIDED_BY_LABEL: Record<ProvidedBy, string> = { applicant: 'Applicant', landlord: 'Landlord / Owner', agent: 'Agent' }

export function isApplicationType(v: string): v is ApplicationType {
  return v === 'lease' || v === 'purchase' || v === 'additional_occupant' || v === 'lease_renewal'
}

export interface IntakeDoc {
  id: string
  doc_key: string
  label: string
  provided_by: ProvidedBy
  required: boolean
  note: string | null
  sort_order: number
}

/** The active document checklist for an association + application type, ordered. */
export async function getIntakeChecklist(associationCode: string, type: ApplicationType): Promise<IntakeDoc[]> {
  const { data } = await supabaseAdmin.from('association_intake_documents')
    .select('id, doc_key, label, provided_by, required, note, sort_order')
    .eq('association_code', associationCode.toUpperCase())
    .eq('application_type', type)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  return (data ?? []) as IntakeDoc[]
}

/** The whole checklist for an association, grouped by type (admin view). */
export async function getIntakeChecklistAll(associationCode: string): Promise<Record<ApplicationType, IntakeDoc[]>> {
  const { data } = await supabaseAdmin.from('association_intake_documents')
    .select('id, application_type, doc_key, label, provided_by, required, note, sort_order')
    .eq('association_code', associationCode.toUpperCase())
    .eq('active', true)
    .order('sort_order', { ascending: true })
  const out: Record<ApplicationType, IntakeDoc[]> = { lease: [], purchase: [], additional_occupant: [], lease_renewal: [] }
  for (const r of (data ?? []) as (IntakeDoc & { application_type: ApplicationType })[]) {
    if (isApplicationType(r.application_type)) out[r.application_type].push(r)
  }
  return out
}
