// =====================================================================
// lib/lease-packet.ts
// Server helpers for the per-unit lease-packet e-signature flow: load a
// packet, map it onto the Agreement PDF props, and record a signature
// (with evidence). When both the owner and the tenant have signed, the
// packet is marked completed and the unit.landlord_tenant_agreement
// compliance item is filed — its expiry tracks the lease end, like the
// Approval Letter.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import type { LeasePacketAgreementProps } from '@/lib/lease-packet-pdf'
import { signLeasePacketToken, type LeasePacketRole } from '@/lib/lease-packet-token'
import type { RoleVerification } from '@/lib/lease-packet-verify'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const firstEmail = (e: string | null) => (e ?? '').split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null
const firstNonEmpty = (...vals: (string | null | undefined)[]) => vals.map(v => (v ?? '').trim()).find(Boolean) ?? null

function composeAddress(a: { street: string | null; unit: string | null; city: string | null; state: string | null; zip: string | null }): string | null {
  const street = (a.street ?? '').trim()
  const unit = (a.unit ?? '').trim()
  const line1 = [street, unit && !new RegExp(`\\b(unit|apt|#)\\s*${unit}\\b`, 'i').test(street) ? `Unit ${unit}` : '']
    .filter(Boolean).join(', ')
  const cityState = [(a.city ?? '').trim(), [(a.state ?? '').trim(), (a.zip ?? '').trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const full = [line1, cityState].filter(Boolean).join(', ')
  return full.trim() ? full : null
}

function inviteHtml(role: LeasePacketRole, opts: { name: string | null; legal: string; unit: string; link: string }): { subject: string; html: string } {
  const who = role === 'owner' ? 'Unit Owner / Landlord' : 'Tenant'
  const subject = `Please e-sign the Landlord–Tenant Agreement — Unit ${opts.unit}`
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Hello${opts.name ? ` ${esc(opts.name)}` : ''},</p>
    <p>${esc(opts.legal)} requires the Landlord–Tenant Acknowledgment &amp; Agreement to be signed for <strong>Unit ${esc(opts.unit)}</strong>. You are signing as the <strong>${who}</strong>.</p>
    <p>Please review the full document and sign electronically — it only takes a minute:</p>
    <p style="margin:22px 0"><a href="${opts.link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Review &amp; e-sign →</a></p>
    <p style="color:#6b7280;font-size:12px">No account needed. This link is specific to you.</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
  return { subject, html }
}

/** Create a lease packet for a leased unit and email the owner AND the
 *  tenant their login-free e-signature links for the Landlord–Tenant
 *  Agreement. Extracted from app/api/units/lease-packet/send/route.ts (the
 *  units-portal "Send" button) so a second caller — the applications
 *  request-docs flow, which used to wrongly ask for this as an UPLOAD (see
 *  lib/application-esign-forms.ts) — triggers the exact same send instead
 *  of a parallel, possibly-diverging one. Reads the owner/tenant off
 *  `owners` / `unit_tenant_contacts`, same as the units-portal button — the
 *  packet is a unit-level record, not an application-level one. */
export async function sendLeasePacket(
  associationCode: string, account: string, createdBy: string,
  // A brand-new lease's tenant is often on `application_stakeholders` (the
  // roster the applicant filled in) well before `unit_tenant_contacts` has
  // ever heard of them — that table tracks an ESTABLISHED tenancy, synced
  // separately. Without this override the packet would silently find only
  // the owner and never invite the tenant. Owner intentionally has no such
  // override: `owners` is the one authoritative source for who owns a unit,
  // application context or not.
  // leaseStart/leaseEnd: the CURRENT application's own term (listing_
  // applications.lease_start/lease_end, set from the uploaded lease itself —
  // see lib/preapply.ts's backfillPrimaryContactFromLease). Real bug,
  // 2026-08-27, MANXI 706: without this override the packet fell back to
  // unit_tenant_contacts, which is scoped to the UNIT and only refreshes on
  // approval — it was still carrying the PREVIOUS tenant's dates while this
  // application was in progress.
  tenantOverride?: { name?: string | null; email?: string | null; phone?: string | null; leaseStart?: string | null; leaseEnd?: string | null } | null,
): Promise<
  { ok: true; packetId: string; sent: string[]; skipped: string[] } | { ok: false; error: string }
> {
  // `account` may arrive as the bare unit number (an application only ever
  // knows unit_label) or the true account_number (what the units portal
  // passes) — VPCI-style accounts carry a building letter unit_label alone
  // can't reproduce, so this can't just concatenate associationCode+unit and
  // call it done. Match either form against owners; unit_tenant_contacts'
  // own unit_ref has shown up in both shapes too (confirmed live: MANXI 912
  // stores it as the full account number), so the same two-way match applies
  // there.
  const accountGuess = `${associationCode}${account}`.toUpperCase()
  const [{ data: owner }, { data: tenant }, { data: assoc }] = await Promise.all([
    supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, phone, phone_e164, unit_number')
      .eq('association_code', associationCode)
      .or(`unit_number.eq.${account},account_number.eq.${account},account_number.eq.${accountGuess}`)
      .or('status.neq.previous,status.is.null').maybeSingle(),
    supabaseAdmin.from('unit_tenant_contacts').select('tenant_name, tenant_email, tenant_phone, lease_start, lease_end')
      .eq('association_code', associationCode).or(`unit_ref.eq.${account},unit_ref.eq.${accountGuess}`).maybeSingle(),
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', associationCode).maybeSingle(),
  ])

  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || associationCode
  const ownerName = (owner?.entity_name as string | null) || [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim() || null
  const ownerEmail = firstEmail((owner?.emails as string | null) ?? null)
  const ownerMobile = firstNonEmpty((owner?.phone as string | null), (owner?.phone_e164 as string | null))
  const tenantName = firstNonEmpty(tenantOverride?.name, tenant?.tenant_name as string | null)
  const tenantEmail = firstEmail(tenantOverride?.email ?? (tenant?.tenant_email as string | null) ?? null)
  const tenantMobile = firstNonEmpty(tenantOverride?.phone, tenant?.tenant_phone as string | null)
  const unitLabel = (owner?.unit_number as string | null) || account
  const propertyAddress = composeAddress({
    street: (assoc?.principal_address as string | null) ?? null, unit: unitLabel,
    city: (assoc?.city as string | null) ?? null, state: (assoc?.state as string | null) ?? null, zip: (assoc?.zip as string | null) ?? null,
  })

  if (!ownerEmail && !tenantEmail) return { ok: false, error: 'No owner or tenant email on file — add one first.' }

  const { data: created, error } = await supabaseAdmin.from('lease_packets').insert({
    association_code: associationCode, unit_ref: account, unit_number: unitLabel,
    association_legal_name: legal, owner_name: ownerName, owner_email: ownerEmail, owner_mobile: ownerMobile,
    tenant_name: tenantName, tenant_email: tenantEmail, tenant_mobile: tenantMobile,
    property_address: propertyAddress,
    lease_start: firstNonEmpty(tenantOverride?.leaseStart, tenant?.lease_start as string | null),
    lease_end: firstNonEmpty(tenantOverride?.leaseEnd, tenant?.lease_end as string | null),
    effective_date: new Date().toISOString().slice(0, 10), status: 'sent', created_by: createdBy,
  }).select('id').single()
  if (error || !created) return { ok: false, error: `Could not create packet: ${error?.message ?? 'unknown'}` }

  const sent: string[] = [], skipped: string[] = []
  for (const [role, name, email] of [['owner', ownerName, ownerEmail], ['tenant', tenantName, tenantEmail]] as [LeasePacketRole, string | null, string | null][]) {
    if (!email) { skipped.push(`${role} (no email)`); continue }
    const link = `${APP}/lease-packet/${await signLeasePacketToken(created.id, role)}`
    const { subject, html } = inviteHtml(role, { name, legal, unit: unitLabel, link })
    try { await sendEmail({ to: email, subject, html }); sent.push(`${role} → ${email}`) }
    catch (e) { skipped.push(`${role} (send failed: ${e instanceof Error ? e.message : 'error'})`) }
  }

  return { ok: true, packetId: String(created.id), sent, skipped }
}

/** The most recent non-void packet for a unit, if any — same bare-unit /
 *  account_number two-way match sendLeasePacket uses. Lets a caller show
 *  "not sent yet" vs "sent, waiting on X" vs "signed" without creating a
 *  new packet just to check. */
export async function findUnitLeasePacket(associationCode: string, account: string): Promise<
  { id: string; status: 'sent' | 'partially_signed' | 'completed' | 'void'; ownerSignedAt: string | null; tenantSignedAt: string | null } | null
> {
  const accountGuess = `${associationCode}${account}`.toUpperCase()
  const { data } = await supabaseAdmin.from('lease_packets')
    .select('id, status, owner_signed_at, tenant_signed_at')
    .eq('association_code', associationCode)
    .or(`unit_ref.eq.${account},unit_ref.eq.${accountGuess}`)
    .neq('status', 'void')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  return {
    id: String(data.id), status: data.status as 'sent' | 'partially_signed' | 'completed' | 'void',
    ownerSignedAt: (data.owner_signed_at as string | null) ?? null, tenantSignedAt: (data.tenant_signed_at as string | null) ?? null,
  }
}

export interface LeasePacketRow {
  id: string
  association_code: string
  unit_ref: string
  unit_number: string | null
  association_legal_name: string | null
  owner_name: string | null
  owner_email: string | null
  owner_mobile: string | null
  tenant_name: string | null
  tenant_email: string | null
  tenant_mobile: string | null
  property_address: string | null
  lease_start: string | null
  lease_end: string | null
  effective_date: string | null
  status: 'sent' | 'partially_signed' | 'completed' | 'void'
  owner_signed_at: string | null
  owner_sig_name: string | null
  owner_sig_image: string | null
  owner_sig_ip: string | null
  tenant_signed_at: string | null
  tenant_sig_name: string | null
  tenant_sig_image: string | null
  tenant_sig_ip: string | null
  owner_verification: RoleVerification | null
  tenant_verification: RoleVerification | null
  created_at: string
}

const COLS =
  'id, association_code, unit_ref, unit_number, association_legal_name, owner_name, owner_email, owner_mobile, ' +
  'tenant_name, tenant_email, tenant_mobile, property_address, ' +
  'lease_start, lease_end, effective_date, status, owner_signed_at, owner_sig_name, owner_sig_image, owner_sig_ip, ' +
  'tenant_signed_at, tenant_sig_name, tenant_sig_image, tenant_sig_ip, owner_verification, tenant_verification, created_at'

export async function getLeasePacket(id: string): Promise<LeasePacketRow | null> {
  const { data } = await supabaseAdmin.from('lease_packets').select(COLS).eq('id', id).maybeSingle()
  return (data as LeasePacketRow | null) ?? null
}

/** Map a packet row onto the Agreement PDF props. Signatures are included
 *  only for roles that have signed (so the review copy shows blanks). */
export function agreementPropsFromPacket(p: LeasePacketRow): LeasePacketAgreementProps {
  return {
    associationLegalName: p.association_legal_name ?? p.association_code,
    unitNumber: p.unit_number ?? p.unit_ref,
    propertyAddress: p.property_address,
    ownerName: p.owner_name,
    ownerMobile: p.owner_mobile,
    tenantNames: p.tenant_name ? [p.tenant_name] : [],
    tenantMobile: p.tenant_mobile,
    leaseStart: p.lease_start,
    leaseEnd: p.lease_end,
    effectiveDate: p.effective_date,
    ownerEmail: p.owner_email,
    tenantEmail: p.tenant_email,
    ownerSig: p.owner_signed_at
      ? { name: p.owner_sig_name ?? p.owner_name ?? '', image: p.owner_sig_image, signedAt: p.owner_signed_at, email: p.owner_email, ip: p.owner_sig_ip, verification: p.owner_verification ?? null }
      : null,
    tenantSig: p.tenant_signed_at
      ? { name: p.tenant_sig_name ?? p.tenant_name ?? '', image: p.tenant_sig_image, signedAt: p.tenant_signed_at, email: p.tenant_email, ip: p.tenant_sig_ip, verification: p.tenant_verification ?? null }
      : null,
    documentId: p.id,
  }
}

/** Has the given role already signed this packet? */
export function roleSigned(p: LeasePacketRow, role: LeasePacketRole): boolean {
  return role === 'owner' ? !!p.owner_signed_at : !!p.tenant_signed_at
}

/** The role's email / mobile snapshotted on the packet. */
export function roleEmail(p: LeasePacketRow, role: LeasePacketRole): string | null {
  return role === 'owner' ? p.owner_email : p.tenant_email
}
export function rolePhone(p: LeasePacketRow, role: LeasePacketRole): string | null {
  return role === 'owner' ? p.owner_mobile : p.tenant_mobile
}
/** Phone OTP is required for a role only when a mobile is on file. */
export function rolePhoneRequired(p: LeasePacketRow, role: LeasePacketRole): boolean {
  return !!(rolePhone(p, role) ?? '').trim()
}
export function roleVerification(p: LeasePacketRow, role: LeasePacketRole): RoleVerification | null {
  return role === 'owner' ? p.owner_verification : p.tenant_verification
}

/** Merge a patch into the role's verification certificate (idempotent-safe). */
export async function setRoleVerification(id: string, role: LeasePacketRole, patch: RoleVerification): Promise<RoleVerification> {
  const p = await getLeasePacket(id)
  const current = (p ? roleVerification(p, role) : null) ?? {}
  const next: RoleVerification = { ...current, ...patch }
  const col = role === 'owner' ? 'owner_verification' : 'tenant_verification'
  await supabaseAdmin.from('lease_packets').update({ [col]: next, updated_at: new Date().toISOString() }).eq('id', id)
  return next
}

export interface SignInput { name: string; image: string | null; ip: string | null }

/** Record one role's signature. Idempotent-safe: refuses to overwrite an
 *  existing signature for that role. When both roles have signed, marks the
 *  packet completed and files unit.landlord_tenant_agreement (expiry = lease
 *  end, mirroring the Approval Letter). */
export async function recordLeaseSignature(
  id: string, role: LeasePacketRole, input: SignInput,
): Promise<{ ok: true; status: LeasePacketRow['status']; bothSigned: boolean } | { ok: false; error: string }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Please type your full legal name.' }

  const p = await getLeasePacket(id)
  if (!p) return { ok: false, error: 'This signing link is no longer valid.' }
  if (p.status === 'void') return { ok: false, error: 'This lease packet has been voided.' }
  if (roleSigned(p, role)) return { ok: false, error: 'You have already signed this document.' }

  const now = new Date().toISOString()
  const otherSigned = role === 'owner' ? !!p.tenant_signed_at : !!p.owner_signed_at
  const bothSigned = otherSigned   // the other party had already signed → now both have
  const status: LeasePacketRow['status'] = bothSigned ? 'completed' : 'partially_signed'

  const patch: Record<string, unknown> = { status, updated_at: now }
  if (role === 'owner') { patch.owner_signed_at = now; patch.owner_sig_name = name; patch.owner_sig_image = input.image; patch.owner_sig_ip = input.ip }
  else { patch.tenant_signed_at = now; patch.tenant_sig_name = name; patch.tenant_sig_image = input.image; patch.tenant_sig_ip = input.ip }

  const { error } = await supabaseAdmin.from('lease_packets').update(patch).eq('id', id)
  if (error) return { ok: false, error: `Could not save your signature: ${error.message}` }

  if (bothSigned) { await fileAgreementCompliance(p); await mirrorAgreementToOnGoing(p) }
  return { ok: true, status, bothSigned }
}

// #3(b): when both sign, render the Agreement PDF and file it into the unit's
// active application — mirrored into the On Going Applications Drive folder and
// recorded as the landlord_tenant_agreement document (so it appears in the
// checklist and becomes a keeper for board approval). Best-effort; the PDF
// render + Drive run only with prod creds, and never block the signature.
async function mirrorAgreementToOnGoing(p: LeasePacketRow): Promise<void> {
  try {
    const digits = String(p.unit_ref ?? '').replace(/\D/g, '')
    if (!digits) return
    const { data: apps } = await supabaseAdmin.from('listing_applications')
      .select('id, listing_id, association_code, unit_label, drive_folder_id')
      .eq('association_code', p.association_code).in('status', ['started', 'submitted', 'under_review', 'approval_sent'])
      .order('created_at', { ascending: false })
    const app = (apps ?? []).find(a => String(a.unit_label ?? '').replace(/\D/g, '') === digits)
    if (!app) return

    const { renderToBuffer } = await import('@react-pdf/renderer')
    const { LeasePacketAgreementPdf } = await import('@/lib/lease-packet-pdf')
    const { mirrorFileToOngoing } = await import('@/lib/drive-application-mirror')
    const pdf = Buffer.from(await renderToBuffer(LeasePacketAgreementPdf(agreementPropsFromPacket(p))) as unknown as Uint8Array)
    const { data: sh } = await supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', app.id).eq('is_primary', true).maybeSingle()
    const filename = 'Landlord-Tenant-Agreement-e-signed.pdf'
    const now = new Date()
    const rename = `${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, '0')}_Agreement.pdf`

    // Copy into the app-docs bucket + record the checklist document.
    const path = `intake/${app.id}/landlord_tenant_agreement/${crypto.randomUUID()}.pdf`
    const up = await supabaseAdmin.storage.from('application-docs').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (!up.error) {
      await supabaseAdmin.from('application_documents').delete().eq('application_id', app.id).eq('doc_key', 'landlord_tenant_agreement')
      await supabaseAdmin.from('application_documents').insert({
        application_id: app.id, listing_id: app.listing_id, kind: 'other',
        doc_key: 'landlord_tenant_agreement', doc_label: 'Landlord–Tenant Agreement (e-signed)',
        storage_path: path, filename, suggested_name: rename, expiration_date: (p.lease_end && p.lease_end.trim()) || null,
        mime_type: 'application/pdf', uploaded_by_role: 'esign',
      })
    }

    // Mirror the PDF into the unit's On Going Applications Drive folder.
    if (app.drive_folder_id) {
      await mirrorFileToOngoing({
        unitLabel: String(app.unit_label ?? digits), applicantName: (sh?.name as string | null) ?? null,
        label: 'Landlord-Tenant Agreement (e-signed)', filename, mime: 'application/pdf', buffer: pdf,
        associationCode: (app.association_code as string | null) ?? null,
      })
    }
  } catch { /* best-effort */ }
}

/** File the signed Agreement as the unit's compliance item, expiry = lease end. */
async function fileAgreementCompliance(p: LeasePacketRow): Promise<void> {
  const exp = p.lease_end && p.lease_end.trim() ? p.lease_end.trim() : null
  let statusVal = 'current'
  if (exp) {
    const d = new Date(exp), n = new Date()
    statusVal = d < n || (d.getTime() - n.getTime()) / 86_400_000 <= 45 ? 'expiring' : 'current'
  }
  await supabaseAdmin.from('compliance_records').upsert({
    scope: 'unit', association_code: p.association_code, unit_ref: p.unit_ref,
    item_key: 'unit.landlord_tenant_agreement', applicable: true,
    status: statusVal, expiry_date: exp,
    updated_by: 'system:lease-packet-esign', updated_at: new Date().toISOString(),
  }, { onConflict: 'scope,association_code,unit_ref,item_key' }).then(() => null, () => null)
}
