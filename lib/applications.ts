// =====================================================================
// lib/applications.ts
//
// Foundation for the collaborative leasing/sale application process. Two-tier:
//   unit_listings  — one per unit listed for rent/sale (listing agent, owner,
//                    vacancy). applications — one per applicant GROUP under a
//                    listing. application_stakeholders — every tagged person.
//
// This module is the data + notification layer. The entry-point UIs (listing
// agent, owner validation, applicant agent, applicant) sit on top of it.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { getPortalDocuments } from '@/lib/portal-documents'
import { PUBLIC_RESTRICTED_CATEGORIES } from '@/lib/portal-documents'
import { signApplicationToken } from '@/lib/application-token'

const BASE          = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const STAFF_LEASING = process.env.MAIA_LEASING_ALERT_TO ?? 'service@topfloridaproperties.com'  // Paola

export type StakeholderRole = 'listing_agent' | 'owner' | 'applicant_agent' | 'applicant'
export type ListingType     = 'rent' | 'sale'
export type DocumentKind    = 'listing_agreement' | 'lease' | 'purchase_agreement' | 'applicant_id' | 'other'

export interface UnitListing {
  id: string; association_code: string; account_number: string | null; unit_label: string | null
  listing_type: ListingType | null; status: string
  unit_vacant: boolean | null; prior_tenant_moved_out: boolean | null; prior_lease_ref: string | null
}
export interface Stakeholder {
  id: string; listing_id: string | null; application_id: string | null; role: StakeholderRole
  name: string | null; email: string | null; phone: string | null; token_nonce: string; status: string
}

// ── Listings ──────────────────────────────────────────────────────────
/** Find the OPEN listing for a unit, or create one. Any party can initiate. */
export async function findOrCreateListing(args: {
  assocCode: string; account?: string | null; unitLabel?: string | null
  listingType?: ListingType | null; createdByRole: StakeholderRole | 'staff'
}): Promise<UnitListing> {
  const code = args.assocCode.toUpperCase()
  // Match an open listing for the same unit (by account or unit label).
  let q = supabaseAdmin.from('unit_listings').select('*')
    .eq('association_code', code).eq('status', 'open').order('created_at', { ascending: false }).limit(1)
  if (args.account)        q = q.eq('account_number', args.account)
  else if (args.unitLabel) q = q.eq('unit_label', args.unitLabel)
  const { data: existing } = await q
  if (existing?.[0]) return existing[0] as UnitListing

  const { data, error } = await supabaseAdmin.from('unit_listings').insert({
    association_code: code, account_number: args.account ?? null, unit_label: args.unitLabel ?? null,
    listing_type: args.listingType ?? null, created_by_role: args.createdByRole,
  }).select('*').single()
  if (error) throw new Error(`create listing: ${error.message}`)
  return data as UnitListing
}

/** A new applicant-group application under a listing. Stored in
 *  listing_applications (the existing public.applications table is the separate
 *  detailed ApplyCheck/board/payment pipeline — linked later via
 *  detailed_application_id). */
export async function createApplication(args: { listingId: string; createdByRole: StakeholderRole | 'staff' }): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin.from('listing_applications')
    .insert({ listing_id: args.listingId, created_by_role: args.createdByRole })
    .select('id').single()
  if (error) throw new Error(`create application: ${error.message}`)
  return data as { id: string }
}

// ── Stakeholders ──────────────────────────────────────────────────────
export async function addStakeholder(args: {
  listingId?: string; applicationId?: string; role: StakeholderRole
  name?: string | null; email?: string | null; phone?: string | null
  isPrimary?: boolean; addedByRole?: string; status?: string
}): Promise<Stakeholder> {
  const { data, error } = await supabaseAdmin.from('application_stakeholders').insert({
    listing_id: args.listingId ?? null, application_id: args.applicationId ?? null,
    role: args.role, name: args.name ?? null, email: args.email ?? null, phone: args.phone ?? null,
    is_primary: args.isPrimary ?? false, added_by_role: args.addedByRole ?? null,
    status: args.status ?? 'invited',
  }).select('*').single()
  if (error) throw new Error(`add stakeholder: ${error.message}`)
  return data as Stakeholder
}

/** Secure link for a stakeholder (their portal / financials access). */
export async function stakeholderLink(s: Stakeholder, path = '/apply/portal'): Promise<string> {
  return `${BASE}${path}/${await signApplicationToken(s.id, s.token_nonce)}`
}

// ── Documents ─────────────────────────────────────────────────────────
/** Upload a file (listing agreement, lease, etc.) to the private
 *  application-docs bucket. Returns the storage path + metadata to record. */
export async function uploadApplicationFile(file: File, opts: { assocCode: string; scopeId: string; kind: DocumentKind }): Promise<{ storagePath: string; filename: string; mimeType: string | null }> {
  const safe = (file.name || 'upload').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `${opts.assocCode.toUpperCase()}/${opts.scopeId}/${opts.kind}_${Date.now()}_${safe}`
  const buf  = Buffer.from(await file.arrayBuffer())
  const { error } = await supabaseAdmin.storage.from('application-docs')
    .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw new Error(`upload: ${error.message}`)
  return { storagePath: path, filename: file.name || safe, mimeType: file.type || null }
}

export async function attachDocument(args: {
  listingId?: string; applicationId?: string; stakeholderId?: string
  kind: DocumentKind; storagePath: string; filename: string; mimeType?: string | null; uploadedByRole?: string
}): Promise<void> {
  const { error } = await supabaseAdmin.from('application_documents').insert({
    listing_id: args.listingId ?? null, application_id: args.applicationId ?? null,
    stakeholder_id: args.stakeholderId ?? null, kind: args.kind,
    storage_path: args.storagePath, filename: args.filename, mime_type: args.mimeType ?? null,
    uploaded_by_role: args.uploadedByRole ?? null,
  })
  if (error) throw new Error(`attach document: ${error.message}`)
}

// ── Owner-validation pre-fill ─────────────────────────────────────────
/** Look up the unit's current tenant to PRE-FILL the owner's vacancy questions
 *  (the owner then confirms/corrects). Best-effort against association_tenants. */
export async function lookupUnitOccupancy(assocCode: string, unitLabel: string | null | undefined): Promise<{
  vacant: boolean | null; priorTenant: string | null
}> {
  if (!unitLabel) return { vacant: null, priorTenant: null }
  const { data } = await supabaseAdmin.from('association_tenants')
    .select('first_name, last_name, entity_name')
    .eq('association_code', assocCode.toUpperCase()).eq('unit_number', unitLabel).limit(1)
  const t = data?.[0]
  if (!t) return { vacant: true, priorTenant: null }   // no tenant on file → likely vacant
  const name = (t.entity_name as string) || [t.first_name, t.last_name].filter(Boolean).join(' ').trim() || null
  return { vacant: false, priorTenant: name }
}

// ── Notifications ─────────────────────────────────────────────────────
/** Notify the owner their unit was listed + ask them to validate occupancy.
 *  Resolves the owner email from the owners table when not supplied. */
export async function notifyOwnerOfListing(listing: UnitListing, ownerStakeholder: Stakeholder): Promise<void> {
  let email = ownerStakeholder.email
  if (!email) {
    const { data } = await supabaseAdmin.from('owners')
      .select('emails, association_name')
      .eq('association_code', listing.association_code)
      .eq('account_number', listing.account_number ?? '').limit(1).maybeSingle()
    const emails = Array.isArray(data?.emails) ? (data!.emails as string[]) : String(data?.emails ?? '').split(/[;,]/).map(s => s.trim()).filter(Boolean)
    email = emails[0] ?? null
  }
  const link  = await stakeholderLink(ownerStakeholder, '/apply/owner-validate')
  const what  = listing.listing_type === 'sale' ? 'for SALE' : listing.listing_type === 'rent' ? 'for RENT' : 'on the market'
  const unit  = listing.unit_label ?? listing.account_number ?? 'your unit'
  const to    = [STAFF_LEASING, ...(email ? [email] : [])]
  await sendEmail({
    to,
    subject: `Your unit ${unit} was listed ${what} — please confirm`,
    html: `<div style="font-family:system-ui,sans-serif;color:#1a1a1a;max-width:560px">
      <p>A real-estate agent has listed <strong>Unit ${unit}</strong> ${what} at your association.</p>
      <p>So our records stay accurate, please confirm a couple of quick things about the unit:</p>
      <p><a href="${link}" style="display:inline-block;padding:11px 20px;background:#f26a1b;color:#fff;font-weight:700;text-decoration:none;border-radius:8px">Confirm my unit details →</a></p>
      <p style="color:#6b7280;font-size:13px">If you did not authorize this listing, please contact us right away at ${STAFF_LEASING}.</p>
    </div>`,
  }).catch(() => null)
}

/** Notify the applicant's agent that their applicant started / completed. */
export async function notifyApplicantAgent(applicationId: string, event: 'started' | 'completed'): Promise<void> {
  const { data: agents } = await supabaseAdmin.from('application_stakeholders')
    .select('name, email').eq('application_id', applicationId).eq('role', 'applicant_agent')
  const agent = agents?.[0]
  if (!agent?.email) return
  const verb = event === 'completed' ? 'COMPLETED' : 'STARTED'
  await sendEmail({
    to: [agent.email as string],
    subject: `Your client's application was ${verb.toLowerCase()}`,
    html: `<div style="font-family:system-ui,sans-serif;color:#1a1a1a;max-width:560px">
      <p>Hi ${String(agent.name ?? '').split(' ')[0] || 'there'},</p>
      <p>The applicant you referred has <strong>${verb}</strong> their application.</p>
      ${event === 'started' ? '<p>We’ll let you know when it’s complete.</p>' : '<p>No further action is needed from you right now.</p>'}
      <p style="color:#9ca3af;font-size:12px">— MAIA, PMI Top Florida Properties</p>
    </div>`,
  }).catch(() => null)
}

// ── Financials grant (after a stakeholder registers) ──────────────────
/** Email a registered stakeholder a secure link to the association's budget /
 *  financial statements — the gated categories they couldn't see publicly. */
export async function grantFinancialsToStakeholder(stakeholder: Stakeholder): Promise<void> {
  if (!stakeholder.email) return
  const link = await stakeholderLink(stakeholder, '/apply/financials')
  await sendEmail({
    to: [stakeholder.email],
    subject: `Budget & financial statements — your access link`,
    html: `<div style="font-family:system-ui,sans-serif;color:#1a1a1a;max-width:560px">
      <p>Thanks for registering. As part of your application you now have access to this association's <strong>budget and financial statements</strong>:</p>
      <p><a href="${link}" style="display:inline-block;padding:11px 20px;background:#f26a1b;color:#fff;font-weight:700;text-decoration:none;border-radius:8px">View budget &amp; financials →</a></p>
      <p style="color:#6b7280;font-size:13px">This secure link is just for you; please don't forward it.</p>
    </div>`,
  }).catch(() => null)
}

/** The gated financial documents for an association (budget / financials /
 *  leases) — used by the stakeholder financials route after token verify. */
export async function financialsForAssociation(assocCode: string) {
  const groups = await getPortalDocuments(assocCode)   // full list (not publicOnly)
  return groups
    .map(g => ({ group: g.group, docs: g.docs.filter(d => PUBLIC_RESTRICTED_CATEGORIES.has(d.category)) }))
    .filter(g => g.docs.length > 0)
}
