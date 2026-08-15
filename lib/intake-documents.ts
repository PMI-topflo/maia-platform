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
import { activeConditions, type AnimalKind } from '@/lib/animal-accommodation'

export type ApplicationType = 'lease' | 'purchase' | 'additional_occupant' | 'lease_renewal'
export type ProvidedBy = 'applicant' | 'landlord' | 'agent'

export const APPLICATION_TYPES: { key: ApplicationType; label: string; blurb: string }[] = [
  { key: 'lease',               label: 'Lease / Rental',       blurb: 'A tenant renting the unit' },
  { key: 'purchase',            label: 'Purchase',             blurb: 'A buyer purchasing the unit' },
  { key: 'lease_renewal',       label: 'Lease Renewal',        blurb: 'An existing tenant renewing' },
  { key: 'additional_occupant', label: 'Additional Occupant',  blurb: 'Adding an occupant to an existing lease' },
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
  allow_multiple: boolean
  /** When set, the item only applies if the applicant declared the matching
   *  thing — 'vehicle', 'pet' or 'assistance_animal'. See
   *  lib/animal-accommodation.ts → activeConditions(). */
  condition_key: string | null
}

/** What the applicant has declared about themselves. Drives which conditional
 *  checklist items apply. `{}` means they have not been asked yet. */
export interface Declarations {
  vehicle?: { has: boolean; at?: string } | null
  animal?: { has: boolean; kind?: AnimalKind | null; count?: number | null; at?: string } | null
}

export function parseDeclarations(raw: unknown): Declarations {
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Declarations : {}
}

/** Whether the applicant has answered every gate the checklist actually asks.
 *  An item with no condition_key never needs an answer, so an association whose
 *  checklist has no conditional items never sees these questions at all. */
export function pendingDeclarations(docs: Pick<IntakeDoc, 'condition_key'>[], d: Declarations): ('vehicle' | 'animal')[] {
  const keys = new Set(docs.map(x => x.condition_key).filter(Boolean) as string[])
  const out: ('vehicle' | 'animal')[] = []
  if (keys.has('vehicle') && typeof d.vehicle?.has !== 'boolean') out.push('vehicle')
  if ((keys.has('pet') || keys.has('assistance_animal')) && typeof d.animal?.has !== 'boolean') out.push('animal')
  return out
}

/** The doc_keys that the applicant's declaration has ruled out — "I keep no
 *  vehicle" retires the vehicle documents. Returned as BARE doc_keys, which
 *  every completeness gate reads as "not applicable to anybody on this
 *  application", so the answer survives a later change to the roster.
 *
 *  Unanswered gates rule out NOTHING: an item is only retired by an explicit
 *  "no", never by silence. */
export function declaredNaKeys(
  docs: Pick<IntakeDoc, 'doc_key' | 'condition_key'>[],
  d: Declarations,
  opts?: { petsAllowed?: boolean | null },
): string[] {
  const on = activeConditions(d, opts)
  const answered = (c: string) => c === 'vehicle'
    ? typeof d.vehicle?.has === 'boolean'
    : typeof d.animal?.has === 'boolean'
  return docs
    .filter(x => x.condition_key && answered(x.condition_key) && !on.has(x.condition_key))
    .map(x => x.doc_key)
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
    .select('id, doc_key, label, provided_by, required, note, sort_order, template_path, requires_notarization, per_applicant, allow_multiple, condition_key')
    .eq('association_code', associationCode.toUpperCase())
    .eq('application_type', type)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  return (data ?? []) as IntakeDoc[]
}

/** The whole checklist for an association, grouped by type (admin view). */
export async function getIntakeChecklistAll(associationCode: string): Promise<Record<ApplicationType, IntakeDoc[]>> {
  const { data } = await supabaseAdmin.from('association_intake_documents')
    .select('id, application_type, doc_key, label, provided_by, required, note, sort_order, template_path, requires_notarization, per_applicant, allow_multiple, condition_key')
    .eq('association_code', associationCode.toUpperCase())
    .eq('active', true)
    .order('sort_order', { ascending: true })
  const out: Record<ApplicationType, IntakeDoc[]> = { lease: [], purchase: [], additional_occupant: [], lease_renewal: [] }
  for (const r of (data ?? []) as (IntakeDoc & { application_type: ApplicationType })[]) {
    if (isApplicationType(r.application_type)) out[r.application_type].push(r)
  }
  return out
}
