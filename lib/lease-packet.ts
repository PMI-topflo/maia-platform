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
import type { LeasePacketAgreementProps } from '@/lib/lease-packet-pdf'
import type { LeasePacketRole } from '@/lib/lease-packet-token'
import type { RoleVerification } from '@/lib/lease-packet-verify'

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
      .select('id, listing_id, unit_label, drive_folder_id')
      .eq('association_code', p.association_code).in('status', ['started', 'submitted', 'under_review'])
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
