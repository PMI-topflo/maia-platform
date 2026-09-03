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
import { verifyPreApplyToken, signPreApplyToken } from '@/lib/preapply-token'
import { extractLeaseDetails } from '@/lib/lease-extract'
import type { ApplicationType, ProvidedBy } from '@/lib/intake-documents'
import { quickDocScan } from '@/lib/quick-doc-classify'
import { suggestedIntakeName } from '@/lib/intake-naming'
import { sendEmail } from '@/lib/gmail'
import { notifyDelinquencyOnApplicationOpen } from '@/lib/application-delinquency-notice'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
// Local, not imported from lib/document-request-email.ts — that file already
// imports INTAKE_BUCKET from here, and a mutual top-level import between the
// two is a real circular-init hazard not worth risking for one one-liner.
const splitEmails = (raw: string | null | undefined) =>
  [...new Set((raw ?? '').split(',').map(s => s.trim()).filter(e => e.includes('@')))]

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

// When staff open an application from a lease that arrived by email — no
// tenant contact info in hand, only their name (the case that used to hard-
// block creation: 2026-08-20, MANXI unit 110, a lease renewal forwarded by
// the owner) — the signed lease itself very likely has the tenant's own
// email/phone printed on it. Fill in the PRIMARY applicant's still-blank
// fields from the same extraction autoRosterFromLease already uses. Only
// touches fields that are actually blank; never overwrites anything staff or
// the applicant already entered. Returns true if anything was filled in.
export async function backfillPrimaryContactFromLease(applicationId: string): Promise<boolean> {
  try {
    const { data: primary } = await supabaseAdmin.from('application_stakeholders')
      .select('id, email, phone').eq('application_id', applicationId).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
    const { data: lease } = await supabaseAdmin.from('application_documents')
      .select('storage_path, mime_type').eq('application_id', applicationId).eq('doc_key', 'signed_lease').maybeSingle()
    if (!lease?.storage_path) return false
    const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(lease.storage_path))
    if (!blob) return false
    const d = await extractLeaseDetails(Buffer.from(await blob.arrayBuffer()), (lease.mime_type as string | null) ?? null)

    // The application's OWN lease term, so the Landlord-Tenant Agreement
    // packet (lib/lease-packet.ts) can use it instead of unit_tenant_contacts
    // — that table is scoped to the unit and only refreshes on approval, so it
    // still carries the PREVIOUS tenancy's dates for as long as this one is in
    // progress. Real bug, 2026-08-27, MANXI 706: the packet showed a tenant
    // dead a year before the one currently signing it. Always set when found
    // (not "only if blank") — a re-uploaded/corrected lease should win.
    if (d.leaseStart || d.leaseEnd) {
      await supabaseAdmin.from('listing_applications')
        .update({ lease_start: d.leaseStart, lease_end: d.leaseEnd }).eq('id', applicationId)
    }

    // Return value is scoped to CONTACT fill only, unchanged from before —
    // upload/route.ts uses it to decide whether to loop in the owner as a
    // last resort for missing contact info, which has nothing to do with
    // whether lease dates were found above.
    if (!primary || (primary.email && primary.phone)) return false
    // A multi-tenant lease can come back with both tenants' addresses joined
    // into the one tenantEmail/tenantPhone string — this is filling in ONE
    // stakeholder's single-value fields, so take only the first.
    const first = (v: string | null) => v?.split(',')[0]?.trim() || null
    const patch: Record<string, unknown> = {}
    if (!primary.email && first(d.tenantEmail)) patch.email = first(d.tenantEmail)
    if (!primary.phone && first(d.tenantPhone)) patch.phone = first(d.tenantPhone)
    if (!Object.keys(patch).length) return false
    await supabaseAdmin.from('application_stakeholders').update(patch).eq('id', primary.id)
    return true
  } catch { return false }
}

// Last resort when the primary applicant STILL has no email after the lease
// extraction attempt (a scanned/handwritten lease, or a type extraction
// doesn't cover) — loop in the unit's owner, who staff already has an
// address for (they're often the one who sent the documents in the first
// place). Adds them as a real 'owner' stakeholder and emails them the same
// secure link the rest of the collaborative flow uses, so they can add the
// tenant's contact info themselves. Best-effort; never throws.
export async function loopInOwnerForMissingContact(applicationId: string): Promise<boolean> {
  try {
    const { data: app } = await supabaseAdmin.from('listing_applications')
      .select('association_code, unit_label, application_type').eq('id', applicationId).maybeSingle()
    if (!app?.unit_label) return false
    const code = String(app.association_code), unit = String(app.unit_label)

    const { data: primary } = await supabaseAdmin.from('application_stakeholders')
      .select('name').eq('application_id', applicationId).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
    const applicantName = (primary?.name as string | null)?.trim() || 'the applicant'

    const { data: owners } = await supabaseAdmin.from('owners')
      .select('first_name, last_name, entity_name, emails, status').eq('association_code', code)
      .or(`unit_number.eq.${unit},account_number.eq.${code}${unit}`).or('status.neq.previous,status.is.null')
    const ownerName = (owners ?? [])
      .map(o => (o.entity_name as string | null)?.trim() || `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim())
      .find(Boolean) || 'Owner'
    const emails = [...new Set((owners ?? []).flatMap(o => splitEmails(o.emails as string | null)))]
    if (!emails.length) return false
    const [primaryEmail, ...ccEmails] = emails

    const created = await addStakeholders(applicationId, [{ name: ownerName, email: primaryEmail, role: 'owner' }], 'staff')
    if (!created[0]) return false
    const t = await signPreApplyToken(applicationId, created[0].id)
    const link = `${APP}/pre-apply/${encodeURIComponent(code)}?t=${encodeURIComponent(t)}`

    await sendEmail({
      to: [primaryEmail], cc: ccEmails.length ? ccEmails : undefined,
      subject: `Action needed: ${applicantName}'s contact info — ${code} Unit ${unit}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
        <h2 style="margin:0 0 8px;color:#1f2a44">We need ${esc(applicantName)}'s contact info</h2>
        <p>Thank you for the documents for Unit ${esc(unit)}. We don't have an email or phone on file for <strong>${esc(applicantName)}</strong> yet — we need it to move the application forward and to send them anything further we need.</p>
        <p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Add their contact info →</a></p>
        <p style="color:#9ca3af;font-size:12px">If you already have this on hand, just reply to this email instead.</p>
      </div>`,
    }).catch(() => null)
    return true
  } catch { return false }
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

// email OR phone, never neither -- enforced by the caller (POST /api/pre-apply/
// start), not here. A phone-only applicant (no email on file, no tech-savviness
// assumed) verifies and gets their OTP over SMS/WhatsApp instead of email; see
// send-otp/verify-otp.
export interface IntakeApplicant { name: string; email?: string | null; phone?: string | null }

export interface CreatedIntake { applicationId: string; listingId: string; stakeholderId: string }

/** Which screening provider an application actually uses. Applications
 *  snapshot the association's screening_provider onto themselves AT
 *  CREATION (see createIntake below), so flipping an association's setting
 *  later only ever affects applications started after the flip -- one
 *  already in flight keeps whatever was in effect when it started. NULL
 *  (a row from before this column existed) means tenant_evaluation, full
 *  stop -- never a live associations lookup, since every real application
 *  before 2026-09-03 ran on tenant_evaluation (Checkr was never live
 *  before then). Every caller that needs "what provider is THIS
 *  application on" should go through this, not read associations.screening_provider
 *  directly. */
export function resolveScreeningProvider(raw: string | null | undefined): 'tenant_evaluation' | 'maia_checkr' {
  return raw === 'maia_checkr' ? 'maia_checkr' : 'tenant_evaluation'
}

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

  // Snapshot the association's CURRENT screening provider onto this
  // application right now -- see resolveScreeningProvider's doc comment.
  const { data: assocRow } = await supabaseAdmin.from('associations').select('screening_provider').eq('association_code', assoc).maybeSingle()
  const screeningProvider = resolveScreeningProvider(assocRow?.screening_provider as string | null)

  const { data: app, error: ae } = await supabaseAdmin.from('listing_applications').insert({
    listing_id: listing.id, status: 'started', application_type: input.type, applicant_role: input.role,
    association_code: assoc, unit_label: input.unitLabel, created_by_role: input.role,
    screening_provider: screeningProvider,
  }).select('id').single()
  if (ae || !app) return { error: `Could not start: ${ae?.message ?? 'unknown'}` }

  const { data: sh, error: se } = await supabaseAdmin.from('application_stakeholders').insert({
    application_id: app.id, role: input.role, name: input.applicant.name,
    email: input.applicant.email?.trim() || null, phone: input.applicant.phone ?? null,
    is_primary: true, status: 'started', added_by_role: input.role, started_at: new Date().toISOString(),
  }).select('id').single()
  if (se || !sh) return { error: `Could not start: ${se?.message ?? 'unknown'}` }

  // User direction, 2026-08-27: warn, don't block, when the unit's owner has
  // an open balance more than 30 days past due — the owner is told the
  // application won't be approved until it's settled, the applicant is told
  // to proceed at their own risk. Only for the ordinary tenant/buyer intake
  // (role='applicant') — an owner or agent opening it themselves shouldn't
  // get a notice about themselves. Best-effort, never blocks creation.
  if (input.role === 'applicant' && input.unitLabel) {
    await notifyDelinquencyOnApplicationOpen({
      associationCode: assoc, unitLabel: input.unitLabel,
      applicant: { name: input.applicant.name, email: input.applicant.email || null },
    })
  }

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
  checklistAckSignedAt: string | null
}

const STAKEHOLDER_COLS = 'id, role, name, email, phone, is_primary, status, signed_at, email_verified_at, checklist_ack_signed_at'

function toRow(r: Record<string, unknown>): StakeholderRow {
  const role = String(r.role) as StakeholderRole
  return {
    id: String(r.id), role, name: (r.name as string | null) ?? null, email: (r.email as string | null) ?? null,
    phone: (r.phone as string | null) ?? null, isPrimary: Boolean(r.is_primary), status: String(r.status),
    signs: roleSigns(role), signedAt: (r.signed_at as string | null) ?? null,
    emailVerifiedAt: (r.email_verified_at as string | null) ?? null,
    checklistAckSignedAt: (r.checklist_ack_signed_at as string | null) ?? null,
  }
}

export async function listStakeholders(applicationId: string): Promise<StakeholderRow[]> {
  const { data } = await supabaseAdmin.from('application_stakeholders')
    .select(STAKEHOLDER_COLS)
    .eq('application_id', applicationId).order('is_primary', { ascending: false }).order('created_at', { ascending: true })
  return (data ?? []).map(toRow)
}

export async function getStakeholder(applicationId: string, stakeholderId: string): Promise<StakeholderRow | null> {
  const { data } = await supabaseAdmin.from('application_stakeholders')
    .select(STAKEHOLDER_COLS)
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

/** Add collaborators to an application (deduped by email, or by phone when no
 *  email is given). Returns the created rows so the caller can notify each
 *  one their own invite link -- by email if they have one, else by SMS. */
export async function addStakeholders(
  applicationId: string,
  people: { name: string; email?: string | null; phone?: string | null; role: StakeholderRole }[],
  addedByRole: string,
): Promise<StakeholderRow[]> {
  const existing = await listStakeholders(applicationId)
  const haveEmail = new Set(existing.map(s => (s.email ?? '').trim().toLowerCase()).filter(Boolean))
  const havePhone = new Set(existing.map(s => (s.phone ?? '').replace(/\D/g, '')).filter(p => p.length >= 7))
  const fresh = people.filter(p => {
    const e = (p.email ?? '').trim().toLowerCase()
    const ph = (p.phone ?? '').replace(/\D/g, '')
    const hasContact = e.includes('@') || ph.length >= 7
    if (!hasContact || !p.name.trim() || !isStakeholderRole(p.role)) return false
    if (e && haveEmail.has(e)) return false
    if (!e && ph && havePhone.has(ph)) return false
    if (e) haveEmail.add(e)
    if (ph) havePhone.add(ph)
    return true
  })
  if (fresh.length === 0) return []
  const { data } = await supabaseAdmin.from('application_stakeholders').insert(
    fresh.map(p => ({
      application_id: applicationId, role: p.role, name: p.name.trim(), email: p.email?.trim() || null,
      phone: p.phone?.trim() || null, is_primary: false, status: 'invited', added_by_role: addedByRole,
    })),
  ).select(STAKEHOLDER_COLS)
  return (data ?? []).map(toRow)
}

export async function markStakeholderNotified(stakeholderId: string): Promise<void> {
  await supabaseAdmin.from('application_stakeholders')
    .update({ notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', stakeholderId)
}

// Named for email historically -- reused as-is for phone-verified stakeholders
// too (email_verified_at doubles as "identity verified at", regardless of
// channel) rather than adding a second column/migration for the same gate.
export async function markStakeholderVerified(stakeholderId: string): Promise<void> {
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

/** Record a stakeholder's checklist acknowledgment signature (Phase 2,
 *  docs/ROADMAP.md's Phasing item 2) -- distinct from signStakeholderRules
 *  above, which signs a different document at a different point in the flow. */
export async function signChecklistAck(stakeholderId: string, ack: { name: string; signature: string | null; ip: string | null }): Promise<void> {
  const now = new Date().toISOString()
  await supabaseAdmin.from('application_stakeholders')
    .update({ checklist_ack_name: ack.name, checklist_ack_signature: ack.signature, checklist_ack_ip: ack.ip, checklist_ack_signed_at: now, updated_at: now })
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
  // Set once the primary applicant has paid + consented to screening via the
  // /apply wizard hand-off (app/api/apply/link-listing) — the gate on
  // app/pre-apply/[code]/page.tsx clears once this is non-null.
  detailedApplicationId: string | null
}

export async function getIntake(applicationId: string): Promise<IntakeState | null> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, application_type, applicant_role, unit_label, status, submitted_at, detailed_application_id')
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
    detailedApplicationId: (app.detailed_application_id as string | null) ?? null,
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
