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
