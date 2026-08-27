// =====================================================================
// lib/lease-renewal-check.ts
//
// The lease-renewal check-in: the "Lease expiring in N days" cron
// (app/api/cron/lease-renewal-alerts/route.ts) used to tell the owner and
// tenant a lease was ending with no way to actually act on it — just a
// mailto link. This gives both parties a real link (app/lease-renewal/
// [token]/page.tsx) with a call to action, and wires each answer to the
// right side effect.
//
// One lease_renewal_checks row per (association, unit, lease_end) — created
// once by the cron's 30-day pass and reused by the 7-day pass, so the SAME
// link works throughout. owner_token/tenant_token are separate so each
// party's link only ever lets them answer as themselves; no OTP (matches
// /request/[token]'s existing precedent for this class of low-risk action).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { createIntake, type IntakeApplicant } from '@/lib/preapply'
import { getIntakeChecklist, providedByOkForRole } from '@/lib/intake-documents'
import { isEsignItem, sendEsignFormsForItems } from '@/lib/application-esign-forms'
import { sendLeasePacket, findUnitLeasePacket } from '@/lib/lease-packet'
import { sendDocumentRequestEmails, type RequestItem } from '@/lib/document-request-email'
import { sendEmail } from '@/lib/gmail'

export type OwnerOccupancy = 'owner_occupied' | 'leased' | 'vacant'
export type OwnerResponse = 'renew' | 'signed'
export type TenantResponse = 'renew' | 'vacating' | 'vacated' | 'signed' | 'apply'

export interface LeaseRenewalCheck {
  id: string
  association_code: string
  unit_label: string
  lease_end: string
  owner_token: string
  tenant_token: string
  owner_email: string | null
  tenant_email: string | null
  owner_name: string | null
  tenant_name: string | null
  owner_occupancy: OwnerOccupancy | null
  owner_response: OwnerResponse | null
  owner_responded_at: string | null
  tenant_response: TenantResponse | null
  tenant_responded_at: string | null
  application_id: string | null
}

const PMI = process.env.STAFF_ALERT_EMAIL ?? 'PMI@topfloridaproperties.com'
const AR = process.env.LEASE_ALERT_CC ?? 'ar@topfloridaproperties.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

/** Find or create the check-in row for this unit's lease end — the SAME row
 *  across the 30-day and 7-day reminder, so the link in both emails matches. */
export async function findOrCreateCheck(input: {
  associationCode: string; unitLabel: string; leaseEnd: string
  ownerEmail: string | null; tenantEmail: string | null; ownerName: string | null; tenantName: string | null
}): Promise<LeaseRenewalCheck | null> {
  const code = input.associationCode.toUpperCase()
  const { data: existing } = await supabaseAdmin.from('lease_renewal_checks')
    .select('*').eq('association_code', code).eq('unit_label', input.unitLabel).eq('lease_end', input.leaseEnd).maybeSingle()
  if (existing) {
    // Addresses can change between the 30-day and 7-day window — keep them
    // current, but never touch an answer already given.
    const patch: Record<string, unknown> = {}
    if (input.ownerEmail && input.ownerEmail !== existing.owner_email) patch.owner_email = input.ownerEmail
    if (input.tenantEmail && input.tenantEmail !== existing.tenant_email) patch.tenant_email = input.tenantEmail
    if (input.ownerName && input.ownerName !== existing.owner_name) patch.owner_name = input.ownerName
    if (input.tenantName && input.tenantName !== existing.tenant_name) patch.tenant_name = input.tenantName
    if (Object.keys(patch).length === 0) return existing as LeaseRenewalCheck
    const { data: updated } = await supabaseAdmin.from('lease_renewal_checks').update(patch).eq('id', existing.id).select('*').maybeSingle()
    return (updated ?? existing) as LeaseRenewalCheck
  }
  const { data: created } = await supabaseAdmin.from('lease_renewal_checks').insert({
    association_code: code, unit_label: input.unitLabel, lease_end: input.leaseEnd,
    owner_email: input.ownerEmail, tenant_email: input.tenantEmail,
    owner_name: input.ownerName, tenant_name: input.tenantName,
  }).select('*').maybeSingle()
  return created as LeaseRenewalCheck | null
}

export async function loadCheckByToken(token: string): Promise<{ check: LeaseRenewalCheck; role: 'owner' | 'tenant' } | null> {
  const { data: asOwner } = await supabaseAdmin.from('lease_renewal_checks').select('*').eq('owner_token', token).maybeSingle()
  if (asOwner) return { check: asOwner as LeaseRenewalCheck, role: 'owner' }
  const { data: asTenant } = await supabaseAdmin.from('lease_renewal_checks').select('*').eq('tenant_token', token).maybeSingle()
  if (asTenant) return { check: asTenant as LeaseRenewalCheck, role: 'tenant' }
  return null
}

/** True once BOTH the currently-relevant answers are in — used by the cron to
 *  stop sending further reminders for a unit whose parties have already
 *  responded. The owner half only counts once they've picked BOTH their
 *  occupancy and (when leased) one of the two action items; a bare occupancy
 *  toggle alone doesn't count as "satisfied" unless the unit is vacant or
 *  owner-occupied, in which case there's nothing further for them to answer. */
export function isSatisfied(c: LeaseRenewalCheck): { owner: boolean; tenant: boolean } {
  const ownerDone = c.owner_occupancy === 'vacant' || c.owner_occupancy === 'owner_occupied' ? true
    : c.owner_occupancy === 'leased' ? !!c.owner_response
    : false
  return { owner: ownerDone, tenant: !!c.tenant_response }
}

/** Ensure an in-flight lease_renewal application exists for this unit,
 *  reusing one already open rather than opening a duplicate — the owner and
 *  tenant can both trigger this independently (owner "I will renew", tenant
 *  "start a renewal application"), and a second click must not double-open. */
async function ensureRenewalApplication(check: LeaseRenewalCheck, triggeredBy: 'owner' | 'tenant'): Promise<string> {
  if (check.application_id) return check.application_id

  const { data: existingApp } = await supabaseAdmin.from('listing_applications')
    .select('id').eq('association_code', check.association_code).eq('unit_label', check.unit_label)
    .eq('application_type', 'lease_renewal').not('status', 'in', '("approved","declined","withdrawn")')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (existingApp) {
    await supabaseAdmin.from('lease_renewal_checks').update({ application_id: existingApp.id }).eq('id', check.id)
    return String(existingApp.id)
  }

  // The renewal belongs to the tenant even when the owner is the one who
  // triggered it ("I will renew the lease" on the owner's own spec means
  // "have the tenant renew") — use the tenant's contact when known, and only
  // fall back to the owner's when it isn't.
  const applicant: IntakeApplicant = check.tenant_email
    ? { name: check.tenant_name || 'Tenant', email: check.tenant_email, phone: null }
    : { name: check.owner_name || 'Owner', email: check.owner_email || '', phone: null }

  const created = await createIntake({
    associationCode: check.association_code, type: 'lease_renewal', role: 'applicant',
    unitLabel: check.unit_label, applicant,
  })
  if ('error' in created) throw new Error(created.error)

  await supabaseAdmin.from('lease_renewal_checks').update({ application_id: created.applicationId }).eq('id', check.id)
  void triggeredBy
  return created.applicationId
}

/** Push the FULL lease_renewal checklist as document requests — the
 *  automated equivalent of staff ticking every box on the request-docs panel
 *  (app/api/admin/pre-apply/[id]/request-docs/route.ts), just triggered by
 *  the check-in answer instead of a staff click. Reuses the same lower-level
 *  primitives (checklist, esign forms, lease packet, document_requests +
 *  sendDocumentRequestEmails) that route already relies on. */
async function requestFullChecklist(applicationId: string, check: LeaseRenewalCheck, createdBy: string) {
  const code = check.association_code
  const unit = check.unit_label
  const checklist = await getIntakeChecklist(code, 'lease_renewal')
  if (!checklist.length) return

  const { data: staffOnlyRows } = await supabaseAdmin.from('association_intake_documents')
    .select('doc_key').eq('association_code', code).eq('application_type', 'lease_renewal').eq('provided_by', 'staff')
  const staffOnlyKeys = new Set((staffOnlyRows ?? []).map(r => String(r.doc_key)))
  const askable = checklist.filter(i => !staffOnlyKeys.has(i.doc_key))

  const formItems = askable.filter(i => isEsignItem(i.doc_key))
  const packetItems = askable.filter(i => i.doc_key === 'landlord_tenant_agreement')
  const uploadItems = askable.filter(i => !isEsignItem(i.doc_key) && i.doc_key !== 'landlord_tenant_agreement')

  if (formItems.length) await sendEsignFormsForItems(applicationId, formItems.map(i => i.doc_key), createdBy)

  if (packetItems.length) {
    const existingPacket = await findUnitLeasePacket(code, unit)
    if (!existingPacket) {
      await sendLeasePacket(code, unit, createdBy, {
        name: check.tenant_name, email: check.tenant_email, phone: null,
        leaseStart: null, leaseEnd: check.lease_end,
      })
    }
  }

  if (!uploadItems.length) return
  const ownerItems: RequestItem[] = uploadItems.filter(i => providedByOkForRole('owner', i.provided_by)).map(i => ({ doc_key: i.doc_key, label: i.label, recipient: 'owner' as const }))
  const tenantItems: RequestItem[] = uploadItems.filter(i => providedByOkForRole('tenant', i.provided_by)).map(i => ({ doc_key: i.doc_key, label: i.label, recipient: 'tenant' as const }))
  const items = [...ownerItems, ...tenantItems]
  if (!items.length) return

  const ownerToken = ownerItems.length && check.owner_email ? crypto.randomUUID() : null
  const tenantToken = tenantItems.length && check.tenant_email ? crypto.randomUUID() : null
  if (!ownerToken && !tenantToken) return

  const { data: created } = await supabaseAdmin.from('document_requests').insert({
    application_id: applicationId, association_code: code, unit_label: unit, items,
    message: null, owner_token: ownerToken, tenant_token: tenantToken,
    owner_email: ownerToken ? check.owner_email : null, tenant_email: tenantToken ? check.tenant_email : null,
    created_by: createdBy,
  }).select('id').maybeSingle()
  if (created) await sendDocumentRequestEmails(String(created.id))
}

/** Single-item request for the one document that IS the answer — "I already
 *  signed a new lease." Reuses the same document_requests + upload-link
 *  infra as everything else, just scoped to one item instead of the full
 *  checklist. */
async function requestSignedLeaseUpload(applicationId: string, check: LeaseRenewalCheck, recipient: 'owner' | 'tenant', createdBy: string) {
  const email = recipient === 'owner' ? check.owner_email : check.tenant_email
  if (!email) return
  const token = crypto.randomUUID()
  const items: RequestItem[] = [{ doc_key: 'signed_lease', label: 'Signed lease', recipient }]
  const { data: created } = await supabaseAdmin.from('document_requests').insert({
    application_id: applicationId, association_code: check.association_code, unit_label: check.unit_label, items,
    message: null,
    owner_token: recipient === 'owner' ? token : null, tenant_token: recipient === 'tenant' ? token : null,
    owner_email: recipient === 'owner' ? email : null, tenant_email: recipient === 'tenant' ? email : null,
    created_by: createdBy,
  }).select('id').maybeSingle()
  if (created) await sendDocumentRequestEmails(String(created.id), { only: recipient })
}

function notifyHtml(o: { headline: string; unit: string; assoc: string; detail: string }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p style="font-size:16px;font-weight:600;margin:0 0 10px">${esc(o.headline)} — Unit ${esc(o.unit)}, ${esc(o.assoc)}</p>
    <p>${esc(o.detail)}</p>
    <p style="color:#6b7280;font-size:12px">— MAIA, PMI Top Florida Properties</p>
  </div>`
}

/** Update unit_occupancy and notify staff + board (+ the owner, when it was
 *  the TENANT who reported the change — the owner already knows when they're
 *  the one reporting it). */
async function updateOccupancyAndNotify(check: LeaseRenewalCheck, status: OwnerOccupancy, reportedBy: 'owner' | 'tenant', detail: string) {
  await supabaseAdmin.from('unit_occupancy').upsert({
    association_code: check.association_code, unit_ref: check.unit_label, status,
    updated_by: `lease-renewal-check:${reportedBy}`, updated_at: new Date().toISOString(),
  }, { onConflict: 'association_code,unit_ref' })

  const { data: assocRow } = await supabaseAdmin.from('associations').select('association_name').eq('association_code', check.association_code).maybeSingle()
  const assocName = (assocRow?.association_name as string | null) ?? check.association_code
  const [{ data: mgrs }, { data: board }] = await Promise.all([
    supabaseAdmin.from('building_managers').select('email').eq('association_code', check.association_code).eq('active', true),
    supabaseAdmin.from('association_board_members').select('email').eq('association_code', check.association_code).eq('active', true),
  ])
  const recipients = [...new Set([PMI, AR,
    ...(mgrs ?? []).map(m => m.email as string | null),
    ...(board ?? []).map(b => b.email as string | null),
    reportedBy === 'tenant' ? check.owner_email : null,
  ].filter((e): e is string => !!e && e.includes('@')))]

  const html = notifyHtml({ headline: 'Unit occupancy update', unit: check.unit_label, assoc: assocName, detail })
  for (const to of recipients) { try { await sendEmail({ to, subject: `Unit occupancy update — Unit ${check.unit_label}, ${assocName}`, html }) } catch { /* continue */ } }
}

export type RecordResult = { ok: true } | { ok: false; error: string }

export async function recordOwnerResponse(check: LeaseRenewalCheck, occupancy: OwnerOccupancy | null, response: OwnerResponse | null): Promise<RecordResult> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (occupancy) patch.owner_occupancy = occupancy
  if (response) { patch.owner_response = response; patch.owner_responded_at = new Date().toISOString() }
  await supabaseAdmin.from('lease_renewal_checks').update(patch).eq('id', check.id)
  const updated = { ...check, ...patch } as LeaseRenewalCheck

  try {
    if (occupancy && occupancy !== 'leased') {
      await updateOccupancyAndNotify(updated, occupancy, 'owner',
        occupancy === 'vacant' ? 'The owner reports the unit is now vacant.' : 'The owner reports they now occupy the unit themselves.')
    }
    if (response === 'renew') {
      const applicationId = await ensureRenewalApplication(updated, 'owner')
      await requestFullChecklist(applicationId, updated, 'lease-renewal-check:owner')
    } else if (response === 'signed') {
      const applicationId = await ensureRenewalApplication(updated, 'owner')
      await requestSignedLeaseUpload(applicationId, updated, 'owner', 'lease-renewal-check:owner')
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not complete that action.' }
  }
  return { ok: true }
}

export async function recordTenantResponse(check: LeaseRenewalCheck, response: TenantResponse): Promise<RecordResult> {
  await supabaseAdmin.from('lease_renewal_checks').update({
    tenant_response: response, tenant_responded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', check.id)
  const updated = { ...check, tenant_response: response } as LeaseRenewalCheck

  try {
    if (response === 'vacating' || response === 'vacated') {
      await updateOccupancyAndNotify(updated, 'vacant', 'tenant',
        response === 'vacating' ? 'The tenant reports they will vacate at the end of the current lease term.' : 'The tenant reports they have already vacated the unit.')
    } else if (response === 'apply') {
      const applicationId = await ensureRenewalApplication(updated, 'tenant')
      await requestFullChecklist(applicationId, updated, 'lease-renewal-check:tenant')
    } else if (response === 'signed') {
      const applicationId = await ensureRenewalApplication(updated, 'tenant')
      await requestSignedLeaseUpload(applicationId, updated, 'tenant', 'lease-renewal-check:tenant')
    }
    // 'renew' — logged only; the tenant's own "renew the lease" is intent,
    // not a request. "Start a renewal application" ('apply') is the option
    // that actually opens one, per the user's original spec.
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not complete that action.' }
  }
  return { ok: true }
}
