// =====================================================================
// lib/coi-verdict.ts
//
// Bridges stored COI extractions → the validateCoi() engine for the
// vendor-compliance surface. For a vendor's set of active work orders,
// finds the most recent COI attachment that carries parsed additional-
// insured entities, resolves the association's own name + address, and
// returns a CoiVerdict.
//
// A COI uploaded before the entity extraction shipped (no `coi` in its
// extracted_data) yields an "unverifiable" verdict — flag for a re-upload,
// never a hard fail.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateCoi, type CoiVerdict, type CoiTargetEntity } from '@/lib/coi-validation'
import type { CoiEntity } from '@/lib/vendor-doc-extraction'
import { listVendorInsuranceTypes, setVendorInsuranceRequired } from '@/lib/integrations/cinc'

/** The association as an entity to look for on a COI (name + mailing address). */
export async function associationEntity(assocCode: string | null): Promise<CoiTargetEntity | null> {
  if (!assocCode) return null
  const { data } = await supabaseAdmin
    .from('associations')
    .select('association_name, principal_address, city, state, zip')
    .eq('association_code', assocCode)
    .maybeSingle()
  if (!data) return null
  const address = [data.principal_address, data.city, data.state, data.zip]
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .join(', ')
  return { name: String(data.association_name ?? assocCode), address: address || null }
}

interface StoredExtraction {
  fields?: { expiration_date?: string | null }
  coi?: { additionalInsured?: CoiEntity[]; certificateHolder?: CoiEntity | null }
}

/** Verdict for the newest COI across a vendor's tickets, validated against
 *  PMI + the association. null when there's no COI attachment at all. */
export async function loadCoiVerdict(ticketIds: number[], assocCode: string | null): Promise<CoiVerdict | null> {
  if (!ticketIds.length) return null

  const { data } = await supabaseAdmin
    .from('work_order_attachments')
    .select('extracted_data, extracted_at')
    .in('ticket_id', ticketIds)
    .in('extracted_doc_type', ['coi', 'insurance'])
    .order('extracted_at', { ascending: false })
    .limit(25)
  const rows = (data ?? []) as { extracted_data: StoredExtraction | null }[]
  if (!rows.length) return null

  const assoc = await associationEntity(assocCode)
  if (!assoc) return null   // can't verify additional-insured without the association identity

  // Prefer the newest COI that actually carries parsed entities.
  for (const r of rows) {
    const ed  = r.extracted_data ?? {}
    const coi = ed.coi
    if (coi && ((coi.additionalInsured?.length ?? 0) > 0 || coi.certificateHolder)) {
      return validateCoi(
        { additionalInsured: coi.additionalInsured ?? [], certificateHolder: coi.certificateHolder ?? null },
        ed.fields?.expiration_date ?? null,
        assoc,
      )
    }
  }

  // COI on file but pre-dates entity extraction → unverifiable (still reports expiry).
  return validateCoi(null, rows[0].extracted_data?.fields?.expiration_date ?? null, assoc)
}

// ── COI exemptions ───────────────────────────────────────────────────────────
// Staff-declared, per-vendor override for the invoice-push guard (a vendor
// type that legitimately never carries general-liability insurance — an
// attorney, appraiser, credit-reporting agency, etc). This table is the
// gate's SOURCE OF TRUTH, not CINC's own vendorInsurance.isRequired flag —
// that flag defaults to false for every vendor and isn't maintained by
// anyone, so it can't be trusted to mean "deliberately exempt" on its own.
// setVendorCoiExemption still mirrors the value into CINC (isRequired) so
// CINC's own record stays accurate for anyone looking at it there.

export interface CoiExemption {
  vendorId:   number
  vendorName: string | null
  exempt:     boolean
  reason:     string | null
  setByEmail: string | null
  updatedAt:  string
}

interface ExemptionRow {
  cinc_vendor_id: number
  vendor_name:    string | null
  exempt:         boolean
  reason:         string | null
  set_by_email:   string | null
  updated_at:     string
}

export async function getCoiExemption(vendorId: number): Promise<CoiExemption | null> {
  const { data } = await supabaseAdmin
    .from('vendor_coi_exemptions')
    .select('cinc_vendor_id, vendor_name, exempt, reason, set_by_email, updated_at')
    .eq('cinc_vendor_id', vendorId)
    .maybeSingle()
  const row = data as ExemptionRow | null
  if (!row) return null
  return {
    vendorId: row.cinc_vendor_id, vendorName: row.vendor_name, exempt: row.exempt,
    reason: row.reason, setByEmail: row.set_by_email, updatedAt: row.updated_at,
  }
}

/** Is this vendor exempt from the COI-invalid invoice-push guard? Fails open
 *  to `false` (not exempt — the guard still applies) on a lookup error, same
 *  fail-open convention as the collections gate. */
export async function isVendorCoiExempt(vendorId: number): Promise<boolean> {
  try { return (await getCoiExemption(vendorId))?.exempt === true }
  catch { return false }
}

/** Staff sets (or clears) a vendor's COI exemption. Mirrors the same value
 *  into CINC's General Liability isRequired flag on a best-effort basis —
 *  our own table remains authoritative even if the CINC write fails. */
export async function setVendorCoiExemption(
  vendorId: number, vendorName: string | null, exempt: boolean, reason: string | null, staffEmail: string,
): Promise<void> {
  await supabaseAdmin.from('vendor_coi_exemptions').upsert({
    cinc_vendor_id: vendorId, vendor_name: vendorName, exempt,
    reason, set_by_email: staffEmail, updated_at: new Date().toISOString(),
  }, { onConflict: 'cinc_vendor_id' })

  try {
    const types = await listVendorInsuranceTypes()
    const gl = types.find(t => t.description === 'General Liability')
    if (gl) await setVendorInsuranceRequired(vendorId, gl.id, !exempt)
  } catch (err) {
    console.error('[coi-exemption] CINC mirror failed:', err instanceof Error ? err.message : err)
  }
}
