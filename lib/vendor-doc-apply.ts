// =====================================================================
// lib/vendor-doc-apply.ts
//
// Apply a vendor's compliance docs to a CINC vendor by VendorId — the
// vendor-scoped counterpart to the work-order "→ CINC" push. Used by the
// vendor onboarding portal. Each helper does ONLY the CINC write (callers
// own PDF generation + storage + status tracking).
//   • W-9  → TaxID + CheckName        (updateVendorRecord)
//   • ACH  → Routing/Account/Type     (updateVendorRecord) — gated behind a
//            staff confirm in the onboarding flow (fraud control)
//   • COI  → insurance file + carrier (updateVendorInsuranceFile)
//   • License → number + expiration   (createVendorLicense)
// =====================================================================

import {
  updateVendorRecord,
  updateVendorInsuranceFile,
  createVendorLicense,
  listVendorInsuranceTypes,
} from '@/lib/integrations/cinc'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Private bucket for onboarding docs (W-9/ACH PDFs hold full TIN/account).
const VENDOR_DOCS_BUCKET = 'vendor-docs'
let _bucketReady = false
async function ensureVendorDocsBucket(): Promise<void> {
  if (_bucketReady) return
  const { data } = await supabaseAdmin.storage.listBuckets()
  if (!data?.some(b => b.name === VENDOR_DOCS_BUCKET)) {
    await supabaseAdmin.storage.createBucket(VENDOR_DOCS_BUCKET, { public: false, fileSizeLimit: 25 * 1024 * 1024 }).catch(() => null)
  }
  _bucketReady = true
}

/** Store an onboarding doc (PDF/image) in the private vendor-docs bucket.
 *  Returns the storage path (best-effort; null on failure). */
export async function storeVendorDoc(onboardingId: string, bytes: Buffer, filename: string, contentType = 'application/pdf'): Promise<string | null> {
  await ensureVendorDocsBucket()
  const path = `${onboardingId}/${Date.now()}-${filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)}`
  const { error } = await supabaseAdmin.storage.from(VENDOR_DOCS_BUCKET).upload(path, bytes, { contentType, upsert: true })
  return error ? null : path
}

/** Download a stored onboarding doc from the private vendor-docs bucket. */
export async function getVendorDoc(path: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage.from(VENDOR_DOCS_BUCKET).download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

export interface W9Apply { legalName: string; businessName?: string | null; tin: string }
export async function applyW9ToCinc(vendorId: number, w9: W9Apply): Promise<void> {
  await updateVendorRecord(vendorId, {
    TaxID:     w9.tin.replace(/[^0-9-]/g, ''),
    CheckName: (w9.legalName || w9.businessName || '').trim() || null,
  })
}

export interface AchApply { routing: string; account: string; accountType: 'checking' | 'savings' }
export async function applyAchToCinc(vendorId: number, ach: AchApply): Promise<void> {
  await updateVendorRecord(vendorId, {
    Routing:     ach.routing.replace(/\D/g, ''),
    Account:     ach.account.replace(/\D/g, ''),
    AccountType: ach.accountType === 'savings' ? 1 : 0,
  })
}

/** Pick the CINC insurance type id for a COI. Defaults to General Liability
 *  (fuzzy match against the catalog), else the first type, else 1. */
async function coiInsuranceTypeId(): Promise<number> {
  const types = await listVendorInsuranceTypes().catch(() => [])
  const gl = types.find(t => /general\s*liab/i.test(t.description)) ?? types.find(t => /liab/i.test(t.description))
  return gl?.id ?? types[0]?.id ?? 1
}

export interface CoiApply { carrier?: string | null; policyNumber?: string | null; expiration?: string | null }
export async function applyCoiToCinc(vendorId: number, fileBase64: string, fileName: string, coi: CoiApply): Promise<void> {
  await updateVendorInsuranceFile({
    vendorId,
    insuranceTypeId: await coiInsuranceTypeId(),
    policyNumber:    coi.policyNumber ?? null,
    carrier:         coi.carrier ?? null,
    expiration:      coi.expiration ?? null,
    fileBase64,
    fileName,
  })
}

// CINC has no enumerate-license-types endpoint, so the int is configurable;
// staff can correct the type in CINC. Default 1.
const DEFAULT_LICENSE_TYPE = parseInt(process.env.CINC_DEFAULT_LICENSE_TYPE ?? '1', 10) || 1

export interface LicenseApply { licenseNumber?: string | null; expiration?: string | null; description?: string | null; licenseType?: number }
export async function applyLicenseToCinc(vendorId: number, lic: LicenseApply): Promise<void> {
  await createVendorLicense({
    vendorId,
    licenseType:        lic.licenseType ?? DEFAULT_LICENSE_TYPE,
    licenseNumber:      lic.licenseNumber ?? null,
    licenseExpiration:  lic.expiration ?? null,
    licenseDescription: lic.description ?? null,
    isLicenseRequired:  true,
  })
}
