// =====================================================================
// lib/unit-required-docs.ts
// Occupancy-aware required documents for a unit + the "what's still missing"
// computation. Owner-occupied / leased / vacant units need different docs,
// so the audit and the owner self-service portal both ask occupancy first.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { categoriesForScope } from '@/lib/compliance-taxonomy'

export type Occupancy = 'owner_occupied' | 'leased' | 'vacant'
export const OCCUPANCY_LABEL: Record<Occupancy, string> = {
  owner_occupied: 'Owner-occupied', leased: 'Leased', vacant: 'Vacant',
}

const UNIT_ITEMS = categoriesForScope('unit').flatMap(c => c.items)
const labelFor = (key: string) => UNIT_ITEMS.find(i => i.key === key)?.label ?? key

// Required unit items by occupancy. Keys are from the unit taxonomy.
const BASE = ['unit.ownership', 'unit.contact', 'unit.emergency', 'unit.ho6', 'unit.rules_ack']
const LEASED_EXTRA = ['unit.leasing', 'unit.tenant', 'unit.ho4', 'unit.occupancy']
export function requiredItemKeys(occupancy: Occupancy | null): string[] {
  if (occupancy === 'leased') return [...BASE, ...LEASED_EXTRA]
  // owner-occupied, vacant, or unknown → the base set (HO-6 owners insurance etc.)
  return BASE
}

export interface MissingItem { key: string; label: string }

/** Read this unit's occupancy + compute which required documents are still
 *  missing (no on-file compliance record). */
export async function getUnitComplianceState(assoc: string, unitRef: string): Promise<{ occupancy: Occupancy | null; missing: MissingItem[] }> {
  const [{ data: occ }, { data: recs }] = await Promise.all([
    supabaseAdmin.from('unit_occupancy').select('status').eq('association_code', assoc).eq('unit_ref', unitRef).maybeSingle(),
    supabaseAdmin.from('compliance_records').select('item_key, status').eq('association_code', assoc).eq('scope', 'unit').eq('unit_ref', unitRef),
  ])
  const occupancy = (occ?.status as Occupancy | undefined) ?? null
  const onFile = new Set((recs ?? []).filter(r => r.status !== 'missing' && r.status !== 'na').map(r => r.item_key as string))
  const missing = requiredItemKeys(occupancy).filter(k => !onFile.has(k)).map(k => ({ key: k, label: labelFor(k) }))
  return { occupancy, missing }
}

export async function setUnitOccupancy(assoc: string, unitRef: string, status: Occupancy, updatedBy: string): Promise<void> {
  await supabaseAdmin.from('unit_occupancy').upsert(
    { association_code: assoc, unit_ref: unitRef, status, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'association_code,unit_ref' },
  )
}
