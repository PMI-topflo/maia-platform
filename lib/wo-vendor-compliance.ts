// =====================================================================
// lib/wo-vendor-compliance.ts
//
// The ACH/W-9 compliance gate for adding an invoice to a work order.
// Before an invoice can be uploaded, the WO's vendor must have ACH +
// W-9 on file in CINC. Shared by the popup (GET), the request-docs
// action (POST), and the add-invoice gate.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getVendorComplianceStatus, type VendorComplianceStatus } from '@/lib/integrations/cinc'

/** Paola — copied on every vendor doc request so she can follow up. */
export const VENDOR_REQUEST_CC = process.env.MAIA_VENDOR_REQUEST_CC ?? 'service@topfloridaproperties.com'

export interface WoVendor {
  ticketId:        number
  ticketNumber:    string | null
  associationCode: string | null
  cincVendorId:    number | null
  vendorName:      string | null
  vendorEmail:     string | null
}

export async function loadWoVendor(ticketId: number): Promise<WoVendor | null> {
  const { data: t } = await supabaseAdmin.from('tickets').select('id, ticket_number, association_code').eq('id', ticketId).maybeSingle()
  if (!t) return null
  const { data: wod } = await supabaseAdmin.from('work_order_details').select('vendor_name, vendor_email, cinc_vendor_id').eq('ticket_id', ticketId).maybeSingle()
  return {
    ticketId,
    ticketNumber:    (t.ticket_number as string | null) ?? null,
    associationCode: (t.association_code as string | null) ?? null,
    cincVendorId:    (wod?.cinc_vendor_id as number | null) ?? null,
    vendorName:      (wod?.vendor_name as string | null) ?? null,
    vendorEmail:     (wod?.vendor_email as string | null) ?? null,
  }
}

export interface WoComplianceResult {
  vendor:      WoVendor
  status:      VendorComplianceStatus | null   // null when the vendor isn't linked to CINC
  achOnFile:   boolean
  w9OnFile:    boolean
  missing:     string[]      // human labels ("ACH / banking information", "W-9")
  missingKeys: string[]      // ['ach','w9']
  canVerify:   boolean       // false when there's no CINC vendor to check
  canUpload:   boolean       // true when ACH + W-9 are on file (or can't verify)
}

const ACH_LABEL = 'ACH / banking information'
const W9_LABEL  = 'W-9'

export async function checkWoVendorCompliance(ticketId: number): Promise<WoComplianceResult | null> {
  const vendor = await loadWoVendor(ticketId)
  if (!vendor) return null

  // No CINC vendor linked → we can't verify ACH/W-9. Don't dead-end Paola:
  // allow the upload but flag that it couldn't be checked.
  if (!vendor.cincVendorId) {
    return { vendor, status: null, achOnFile: false, w9OnFile: false, missing: [], missingKeys: [], canVerify: false, canUpload: true }
  }

  const status = await getVendorComplianceStatus(vendor.cincVendorId, vendor.associationCode)
  const achOnFile = status.ach.onFile
  const w9OnFile  = status.w9.onFile
  const missing: string[] = []
  const missingKeys: string[] = []
  if (!achOnFile) { missing.push(ACH_LABEL); missingKeys.push('ach') }
  if (!w9OnFile)  { missing.push(W9_LABEL);  missingKeys.push('w9') }
  return { vendor, status, achOnFile, w9OnFile, missing, missingKeys, canVerify: true, canUpload: achOnFile && w9OnFile }
}

/** Clear the WO's "awaiting vendor docs" follow-up flag — called when the docs
 *  are on file (popup re-check), the vendor submits via the portal, or an
 *  invoice uploads successfully. Best-effort. */
export async function clearWoVendorDocsFlag(ticketId: number): Promise<void> {
  await supabaseAdmin.from('tickets')
    .update({ vendor_docs_requested_at: null, vendor_docs_needed: null })
    .eq('id', ticketId)
    .then(() => null, () => null)
}
