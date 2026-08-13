// =====================================================================
// lib/preapply.ts
//
// Server helpers for the public Pre-Application Compliance intake (B4).
// Multi-collaboration: the person who opens the link self-identifies their
// role (tenant / owner / listing agent / tenant agent), enters their own
// info, then adds everyone else involved. MAIA emails each collaborator their
// own link so they fill their part in parallel — the application populates
// fast. Only APPLICANTS and OWNERS sign the rules acknowledgment; agents
// upload but do not sign.
//
// Built on the existing collaborative-leasing foundation (20260628): one
// intake = a unit_listings row + a listing_applications row + one
// application_stakeholders row per person; uploads are application_documents
// tagged with the checklist item (doc_key) and the stakeholder who provided
// them. No new tables.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPreApplyToken } from '@/lib/preapply-token'
import { extractLeaseDetails } from '@/lib/lease-extract'
import type { ApplicationType, ProvidedBy } from '@/lib/intake-documents'
import { quickDocScan } from '@/lib/quick-doc-classify'
import { suggestedIntakeName } from '@/lib/intake-naming'

export const INTAKE_BUCKET = 'application-docs'

// When a signed lease is saved and the application has NO applicants yet, read
// the tenant name(s) off the lease and create the roster (lead + co-applicants)
// so MAIA fills the applicants automatically. Best-effort; never throws. Returns
// how many applicants it created (0 if a roster already exists or none found).
export async function autoRosterFromLease(applicationId: string): Promise<number> {
  try {
    const { data: existing } = await supabaseAdmin.from('application_stakeholders')
      .select('id').eq('application_id', applicationId).eq('role', 'applicant').limit(1)
    if (existing && existing.length) return 0
    const { data: lease } = await supabaseAdmin.from('application_documents')
      .select('storage_path, mime_type').eq('application_id', applicationId).eq('doc_key', 'signed_lease').maybeSingle()
    if (!lease?.storage_path) return 0
    const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(lease.storage_path))
    if (!blob) return 0
    const d = await extractLeaseDetails(Buffer.from(await blob.arrayBuffer()), (lease.mime_type as string | null) ?? null)
    const seen = new Set<string>()
    const names = d.tenantNames.map(n => n.trim()).filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    if (!names.length) return 0
    await supabaseAdmin.from('application_stakeholders').insert(names.map((name, i) => ({
      application_id: applicationId, role: 'applicant', name, is_primary: i === 0,
      applicant_role: i === 0 ? 'primary_applicant' : 'co_applicant', status: 'active', added_by_role: 'lease',
    })))
    return names.length
  } catch { return 0 }
}

// ── Personas ─────────────────────────────────────────────────────────
// The four ways someone can identify themselves on the welcome page. These
// map onto the application_stakeholders.role CHECK values.
export type StakeholderRole = 'applicant' | 'owner' | 'listing_agent' | 'applicant_agent'

export const PREAPPLY_ROLES: { key: StakeholderRole; label: string; blurb: string; signs: boolean }[] = [
  { key: 'applicant',       label: 'Tenant / Buyer',  blurb: 'You are applying to lease or purchase.',          signs: true  },
  { key: 'owner',           label: 'Owner',           blurb: 'You own the unit (landlord / seller).',            signs: true  },
  { key: 'listing_agent',   label: 'Listing agent',   blurb: 'You represent the owner / seller.',                signs: false },
  { key: 'applicant_agent', label: 'Tenant / Buyer agent', blurb: 'You represent the tenant or buyer.',          signs: false },
]

const ROLE_KEYS = new Set<StakeholderRole>(PREAPPLY_ROLES.map(r => r.key))
export function isStakeholderRole(v: string): v is StakeholderRole { return ROLE_KEYS.has(v as StakeholderRole) }
export function roleLabel(role: string): string { return PREAPPLY_ROLES.find(r => r.key === role)?.label ?? role }

/** Only applicants and owners sign the association-rules acknowledgment. */
export function roleSigns(role: string): boolean { return role === 'applicant' || role === 'owner' }

// The party role each person carries WITHIN an application (Tenant-Evaluation
// style) — a finer classification than the collaboration `role` above, shown on
// the per-applicant tabs. Stored on application_stakeholders.applicant_role.
export const APPLICANT_ROLES: { key: string; label: string }[] = [
  { key: 'primary_applicant', label: 'Primary Applicant' },
  { key: 'co_applicant',      label: 'Co-Applicant' },
  { key: 'owner',             label: 'Owner' },
  { key: 'tenant',            label: 'Tenant' },
  { key: 'spouse_partner',    label: 'Spouse / Partner' },
  { key: 'adult_occupant',    label: 'Adult Occupant' },
  { key: 'minor_dependent',   label: 'Minor / Dependent' },
  { key: 'guarantor',         label: 'Guarantor' },
]
const APPLICANT_ROLE_KEYS = new Set(APPLICANT_ROLES.map(r => r.key))
export function isApplicantRole(v: string): boolean { return APPLICANT_ROLE_KEYS.has(v) }
export function applicantRoleLabel(v: string | null | undefined): string {
  return APPLICANT_ROLES.find(r => r.key === v)?.label ?? ''
}

/** Which checklist bucket a person's uploads belong to. */
export function roleToProvidedBy(role: string): ProvidedBy {
  if (role === 'owner') return 'landlord'
  if (role === 'listing_agent' || role === 'applicant_agent') return 'agent'
  return 'applicant'
}

export interface IntakeApplicant { name: string; email: string; phone?: string | null }

export interface CreatedIntake { applicationId: string; listingId: string; stakeholderId: string }

/** Create a new intake: listing + application + the lead stakeholder (the
 *  person who opened the link, in their chosen role). */
export async function createIntake(input: {
  associationCode: string; type: ApplicationType; role: StakeholderRole; unitLabel: string | null; applicant: IntakeApplicant
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

  const { data: sh, error: se } = await supabaseAdmin.from('application_stakeholders').insert({
    application_id: app.id, role: input.role, name: input.applicant.name,
    email: input.applicant.email, phone: input.applicant.phone ?? null,
    is_primary: true, status: 'started', added_by_role: input.role, started_at: new Date().toISOString(),
  }).select('id').single()
  if (se || !sh) return { error: `Could not start: ${se?.message ?? 'unknown'}` }

  return { applicationId: app.id, listingId: listing.id, stakeholderId: sh.id }
}

// ── Additional-occupant carry-over ───────────────────────────────────
// When an additional-occupant application starts on a unit that already has an
// APPROVED lease/purchase, the occupant doesn't re-submit the whole packet: the
// approved lease, Certificate of Use, HO-6, governing-docs ack, etc. carry over.
// The occupant only adds their own new items (ID, occupant affidavit, a lease
// ADDENDUM instead of a new lease, background-check consent, its own approval
// letter). We copy the approved keeper files into the new application as
// INDEPENDENT storage objects so the two applications never share a blob.
const CARRY_OVER_KEYS = new Set([
  'signed_lease', 'certificate_of_use', 'property_insurance', 'governing_docs_ack',
  'landlord_tenant_agreement', 'board_decision_page', 'tenant_affidavit',
  // NOT board_approval_letter — the additional application gets its own.
])

export async function carryOverApprovedDocs(newAppId: string, associationCode: string, unitLabel: string | null): Promise<number> {
  const unit = (unitLabel ?? '').trim()
  if (!unit) return 0
  const assoc = associationCode.toUpperCase()
  const norm = (v: string) => v.trim().toLowerCase().replace(/^unit\s+/, '')
  const digits = (v: string) => v.replace(/\D/g, '')

  // Most-recent approved lease/purchase/renewal for this unit (the tenant of record).
  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, unit_label, application_type, status, created_at')
    .eq('association_code', assoc).in('application_type', ['lease', 'purchase', 'lease_renewal']).eq('status', 'approved')
    .order('created_at', { ascending: false })
  const src = (apps ?? []).find(a => { const ul = norm(String(a.unit_label ?? '')); return !!ul && (ul === norm(unit) || digits(ul) === digits(unit)) })
  if (!src || src.id === newAppId) return 0

  const [{ data: srcDocs }, { data: existing }, { data: newApp }] = await Promise.all([
    supabaseAdmin.from('application_documents')
      .select('doc_key, doc_label, storage_path, filename, mime_type, expiration_date, no_expiration').eq('application_id', src.id),
    supabaseAdmin.from('application_documents').select('doc_key').eq('application_id', newAppId),
    supabaseAdmin.from('listing_applications').select('listing_id').eq('id', newAppId).maybeSingle(),
  ])
  const have = new Set((existing ?? []).map(e => String(e.doc_key)))
  const pick = (srcDocs ?? []).filter(d => d.doc_key && CARRY_OVER_KEYS.has(String(d.doc_key)) && !have.has(String(d.doc_key)))
  if (!pick.length) return 0

  let filed = 0
  for (const d of pick) {
    const from = String(d.storage_path)
    const ext = from.includes('.') ? from.slice(from.lastIndexOf('.')) : ''
    const to = `${newAppId}/carried/${d.doc_key}${ext}`
    // Independent copy; skip this doc if the source object is gone.
    const { error: ce } = await supabaseAdmin.storage.from(INTAKE_BUCKET).copy(from, to)
    if (ce) continue
    const { error: ie } = await supabaseAdmin.from('application_documents').insert({
      application_id: newAppId, listing_id: (newApp?.listing_id as string | null) ?? null,
      doc_key: d.doc_key, doc_label: `${d.doc_label} (from approved lease)`,
      storage_path: to, filename: d.filename, mime_type: d.mime_type,
      expiration_date: d.expiration_date, no_expiration: d.no_expiration,
      uploaded_by_role: 'carried-over', kind: 'carried_over',
    })
    if (!ie) filed++
  }
  return filed
}

// ── Collaborators ────────────────────────────────────────────────────
export interface StakeholderRow {
  id: string; role: StakeholderRole; name: string | null; email: string | null; phone: string | null
  isPrimary: boolean; status: string; signs: boolean; signedAt: string | null; emailVerifiedAt: string | null
}

function toRow(r: Record<string, unknown>): StakeholderRow {
  const role = String(r.role) as StakeholderRole
  return {
    id: String(r.id), role, name: (r.name as string | null) ?? null, email: (r.email as string | null) ?? null,
    phone: (r.phone as string | null) ?? null, isPrimary: Boolean(r.is_primary), status: String(r.status),
    signs: roleSigns(role), signedAt: (r.signed_at as string | null) ?? null,
    emailVerifiedAt: (r.email_verified_at as string | null) ?? null,
  }
}

export async function listStakeholders(applicationId: string): Promise<StakeholderRow[]> {
  const { data } = await supabaseAdmin.from('application_stakeholders')
    .select('id, role, name, email, phone, is_primary, status, signed_at, email_verified_at')
    .eq('application_id', applicationId).order('is_primary', { ascending: false }).order('created_at', { ascending: true })
  return (data ?? []).map(toRow)
}

export async function getStakeholder(applicationId: string, stakeholderId: string): Promise<StakeholderRow | null> {
  const { data } = await supabaseAdmin.from('application_stakeholders')
    .select('id, role, name, email, phone, is_primary, status, signed_at, email_verified_at')
    .eq('application_id', applicationId).eq('id', stakeholderId).maybeSingle()
  return data ? toRow(data) : null
}

/** For legacy tokens without a stakeholderId: the primary (lead) stakeholder. */
export async function resolvePrimaryStakeholderId(applicationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('application_stakeholders')
    .select('id').eq('application_id', applicationId).eq('is_primary', true).maybeSingle()
  return data ? String(data.id) : null
}

/** Verify a pre-apply token and resolve it to (application, this stakeholder).
 *  Tokens minted before multi-collaboration carry no stakeholderId — those
 *  resolve to the primary (lead) stakeholder. */
export async function resolveToken(token: string): Promise<{ applicationId: string; stakeholder: StakeholderRow } | null> {
  const t = await verifyPreApplyToken(token)
  if (!t) return null
  const sid = t.stakeholderId ?? await resolvePrimaryStakeholderId(t.applicationId)
  if (!sid) return null
  const stakeholder = await getStakeholder(t.applicationId, sid)
  return stakeholder ? { applicationId: t.applicationId, stakeholder } : null
}

/** Add collaborators to an application (deduped by email). Returns the created
 *  rows so the caller can email each an invite link. */
export async function addStakeholders(
  applicationId: string,
  people: { name: string; email: string; phone?: string | null; role: StakeholderRole }[],
  addedByRole: string,
): Promise<StakeholderRow[]> {
  const existing = await listStakeholders(applicationId)
  const have = new Set(existing.map(s => (s.email ?? '').trim().toLowerCase()).filter(Boolean))
  const fresh = people.filter(p => {
    const e = p.email.trim().toLowerCase()
    return e.includes('@') && p.name.trim() && isStakeholderRole(p.role) && !have.has(e) && (have.add(e), true)
  })
  if (fresh.length === 0) return []
  const { data } = await supabaseAdmin.from('application_stakeholders').insert(
    fresh.map(p => ({
      application_id: applicationId, role: p.role, name: p.name.trim(), email: p.email.trim(),
      phone: p.phone?.trim() || null, is_primary: false, status: 'invited', added_by_role: addedByRole,
    })),
  ).select('id, role, name, email, phone, is_primary, status, signed_at, email_verified_at')
  return (data ?? []).map(toRow)
}

export async function markStakeholderNotified(stakeholderId: string): Promise<void> {
  await supabaseAdmin.from('application_stakeholders')
    .update({ notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', stakeholderId)
}

export async function markStakeholderEmailVerified(stakeholderId: string): Promise<void> {
  const now = new Date().toISOString()
  await supabaseAdmin.from('application_stakeholders')
    .update({ email_verified_at: now, status: 'active', started_at: now, updated_at: now })
    .eq('id', stakeholderId)
}

/** Record a stakeholder's rules-acknowledgment signature (applicants/owners). */
export async function signStakeholderRules(stakeholderId: string, ack: { name: string; signature: string | null; ip: string | null }): Promise<void> {
  const now = new Date().toISOString()
  await supabaseAdmin.from('application_stakeholders')
    .update({ rules_ack_name: ack.name, signature_image: ack.signature, rules_ack_ip: ack.ip, signed_at: now, updated_at: now })
    .eq('id', stakeholderId)
}

/** Mark a stakeholder's part complete. */
export async function completeStakeholder(stakeholderId: string): Promise<void> {
  const now = new Date().toISOString()
  await supabaseAdmin.from('application_stakeholders')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('id', stakeholderId)
}

// ── Documents ────────────────────────────────────────────────────────
/** Record an uploaded intake document against its checklist item + the
 *  stakeholder who provided it. */
export async function recordIntakeDoc(applicationId: string, stakeholderId: string | null, doc: { doc_key: string; doc_label: string; storage_path: string; filename: string; mime_type: string | null; uploaded_by_role: string }): Promise<{ ok: boolean; error?: string }> {
  const { data: app } = await supabaseAdmin.from('listing_applications').select('listing_id').eq('id', applicationId).maybeSingle()
  if (!app) return { ok: false, error: 'not found' }
  // Replace any prior upload for the same checklist item (latest wins).
  await supabaseAdmin.from('application_documents').delete().eq('application_id', applicationId).eq('doc_key', doc.doc_key)
  // Read the document for its expiration date. Only the Drive scan used to do
  // this, so anything an applicant uploaded through the link arrived with no
  // expiry at all — which is exactly what the expiry tracking exists for.
  // Best-effort: a failed read must never lose the upload.
  let expiration: string | null = null
  try {
    const dl = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(doc.storage_path)
    if (dl.data) {
      const buf = Buffer.from(await dl.data.arrayBuffer())
      expiration = (await quickDocScan(buf, doc.mime_type ?? 'application/pdf')).expiration
    }
  } catch { /* keep the document even if the scan fails */ }
  let personName: string | null = null
  if (stakeholderId) {
    const { data: sh } = await supabaseAdmin.from('application_stakeholders').select('name').eq('id', stakeholderId).maybeSingle()
    personName = (sh?.name as string | null) ?? null
  }
  const { error } = await supabaseAdmin.from('application_documents').insert({
    application_id: applicationId, listing_id: app.listing_id, stakeholder_id: stakeholderId, kind: 'other',
    doc_key: doc.doc_key, doc_label: doc.doc_label, storage_path: doc.storage_path,
    filename: doc.filename, mime_type: doc.mime_type, uploaded_by_role: doc.uploaded_by_role,
    expiration_date: expiration,
    suggested_name: suggestedIntakeName({ docKey: doc.doc_key, filename: doc.filename, personName }),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Application-level state ──────────────────────────────────────────
export interface IntakeState {
  applicationId: string
  listingId: string
  associationCode: string
  type: ApplicationType
  role: string
  unitLabel: string | null
  status: string
  submittedAt: string | null
  applicant: { name: string | null; email: string | null; phone: string | null } | null
  docKeys: string[]
}

export async function getIntake(applicationId: string): Promise<IntakeState | null> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, application_type, applicant_role, unit_label, status, submitted_at')
    .eq('id', applicationId).maybeSingle()
  if (!app) return null
  const [{ data: sh }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', applicationId).eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('application_documents').select('doc_key').eq('application_id', applicationId),
  ])
  return {
    applicationId: app.id, listingId: app.listing_id, associationCode: String(app.association_code),
    type: app.application_type as ApplicationType, role: String(app.applicant_role ?? 'applicant'),
    unitLabel: (app.unit_label as string | null) ?? null, status: String(app.status), submittedAt: (app.submitted_at as string | null) ?? null,
    applicant: sh ? { name: sh.name as string | null, email: sh.email as string | null, phone: sh.phone as string | null } : null,
    docKeys: (docs ?? []).map(d => String(d.doc_key)).filter(Boolean),
  }
}

/** Finalize the intake for audit: mark submitted so it enters the staff queue.
 *  `transitioned` is true only on the call that actually flips the status
 *  (so the audit-notify email + Drive mirror fire exactly once). */
export async function submitIntake(applicationId: string): Promise<{ ok: boolean; transitioned: boolean; error?: string }> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('listing_applications').update({
    status: 'submitted', submitted_at: now, completed_at: now, updated_at: now,
  }).eq('id', applicationId).neq('status', 'submitted').select('id')
  if (error) return { ok: false, transitioned: false, error: error.message }
  return { ok: true, transitioned: (data?.length ?? 0) > 0 }
}
