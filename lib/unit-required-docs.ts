// =====================================================================
// lib/unit-required-docs.ts
// Occupancy- AND association-type-aware required documents for a unit, plus
// the "what's still missing" computation. The right insurance policy depends
// on BOTH how the unit is used and what kind of association it is:
//   condo owner → HO-6 · HOA homeowner → HO-3 · commercial owner → CPP/BOP
//   residential tenant → HO-4 · commercial tenant → CGL + COI
//   vacant → Vacant Property Policy
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { categoriesForScope } from '@/lib/compliance-taxonomy'

export type Occupancy = 'owner_occupied' | 'leased' | 'vacant'
export const OCCUPANCY_LABEL: Record<Occupancy, string> = {
  owner_occupied: 'Owner-occupied', leased: 'Leased', vacant: 'Vacant',
}
export type AssocKind = 'condo' | 'hoa' | 'commercial' | 'coop'

const UNIT_ITEMS = categoriesForScope('unit').flatMap(c => c.items)
const labelFor = (key: string) => UNIT_ITEMS.find(i => i.key === key)?.label ?? key

async function associationKind(assoc: string): Promise<AssocKind> {
  const { data } = await supabaseAdmin.from('associations').select('association_type').eq('association_code', assoc).maybeSingle()
  const t = String(data?.association_type ?? '').toLowerCase()
  if (t.includes('commercial')) return 'commercial'
  if (t.includes('hoa')) return 'hoa'              // hoa, master_hoa
  if (t.includes('coop')) return 'coop'
  return 'condo'                                    // condo (default for 718)
}

/** The owner's insurance policy item for this association kind + occupancy. */
function ownerInsuranceItem(kind: AssocKind, occupancy: Occupancy | null): string {
  if (occupancy === 'vacant') return 'unit.vacant_policy'
  if (kind === 'commercial') return 'unit.commercial_property'   // CPP / BOP
  if (kind === 'hoa') return 'unit.ho3'                          // HOA homeowner
  return 'unit.ho6'                                              // condo / coop unit owner
}

const BASE_NONINS = ['unit.ownership', 'unit.contact', 'unit.emergency', 'unit.rules_ack']

export function requiredItemKeys(kind: AssocKind, occupancy: Occupancy | null): string[] {
  const req = [...BASE_NONINS, ownerInsuranceItem(kind, occupancy)]
  if (occupancy === 'leased') req.push('unit.leasing', 'unit.tenant', 'unit.occupancy')   // tenant's own HO-4/CGL is requested FROM the tenant
  return req
}

export interface MissingItem { key: string; label: string }
const onFileSet = (recs: { item_key: string; status: string }[] | null) =>
  new Set((recs ?? []).filter(r => r.status !== 'missing' && r.status !== 'na').map(r => r.item_key))

/** This unit's occupancy + which required documents are still missing. */
export async function getUnitComplianceState(assoc: string, unitRef: string): Promise<{ occupancy: Occupancy | null; kind: AssocKind; missing: MissingItem[] }> {
  const [{ data: occ }, { data: recs }, kind] = await Promise.all([
    supabaseAdmin.from('unit_occupancy').select('status').eq('association_code', assoc).eq('unit_ref', unitRef).maybeSingle(),
    supabaseAdmin.from('compliance_records').select('item_key, status').eq('association_code', assoc).eq('scope', 'unit').eq('unit_ref', unitRef),
    associationKind(assoc),
  ])
  const occupancy = (occ?.status as Occupancy | undefined) ?? null
  const onFile = onFileSet(recs)
  const missing = requiredItemKeys(kind, occupancy).filter(k => !onFile.has(k)).map(k => ({ key: k, label: labelFor(k) }))
  return { occupancy, kind, missing }
}

/** What a TENANT must provide, by association kind (commercial → CGL+COI). */
export async function getTenantComplianceState(assoc: string, unitRef: string): Promise<{ missing: MissingItem[]; commercial: boolean }> {
  const [{ data: recs }, kind] = await Promise.all([
    supabaseAdmin.from('compliance_records').select('item_key, status').eq('association_code', assoc).eq('scope', 'unit').eq('unit_ref', unitRef),
    associationKind(assoc),
  ])
  const commercial = kind === 'commercial'
  // Access Control is an internal/office-issued item (not owner/tenant-provided).
  // Usage Type is commercial-only; Pet Registration is residential-only.
  const required = ['unit.tenant', 'unit.vehicle', 'unit.rules_ack', 'unit.leasing', commercial ? 'unit.cgl' : 'unit.ho4']
  required.push(commercial ? 'unit.usage_type' : 'unit.pet')
  const onFile = onFileSet(recs)
  return { missing: required.filter(k => !onFile.has(k)).map(k => ({ key: k, label: labelFor(k) })), commercial }
}

export async function setUnitOccupancy(assoc: string, unitRef: string, status: Occupancy, updatedBy: string): Promise<void> {
  await supabaseAdmin.from('unit_occupancy').upsert(
    { association_code: assoc, unit_ref: unitRef, status, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'association_code,unit_ref' },
  )
}
