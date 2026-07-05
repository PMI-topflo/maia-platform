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

export async function associationKind(assoc: string): Promise<AssocKind> {
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

export interface MissingItem { key: string; label: string; declaredType: string | null }
const onFileSet = (recs: { item_key: string; status: string }[] | null) =>
  new Set((recs ?? []).filter(r => r.status !== 'missing' && r.status !== 'na').map(r => r.item_key))

/** Self-report insurance-type choices, by item_key — shown as a dropdown next
 *  to that item on the owner survey. Deliberately not the single "expected"
 *  policy: an owner's real coverage sometimes differs, and that mismatch is
 *  itself the compliance signal worth surfacing. */
export const INSURANCE_TYPE_OPTIONS: Record<string, string[]> = {
  'unit.ho6': ['HO-6 (Condo/Co-op Unit Owners Policy)', 'HO-3 (Homeowners Policy)', 'Landlord/Rental Dwelling Policy', 'Umbrella/Other', 'None currently'],
  'unit.ho3': ['HO-3 (Homeowners Policy)', 'Landlord/Rental Dwelling Policy', 'Umbrella/Other', 'None currently'],
  'unit.commercial_property': ['Commercial Package Policy (CPP)', 'Business Owners Policy (BOP)', 'Separate Property + Liability', 'Umbrella/Other', 'None currently'],
  'unit.vacant_policy': ['Vacant Property Policy', 'None currently'],
  'unit.ho4': ['HO-4 (Renters/Tenant Policy)', 'Other', 'None currently'],
  'unit.cgl': ['Commercial General Liability (CGL)', 'CGL + Property', 'Other', 'None currently'],
}

export interface CustomRequirement { itemKey: string; label: string; occupancyFilter: Occupancy | null }

/** Staff-defined custom requirements for one association (e.g. City of
 *  Lauderhill's Certificate of Use for Manors XI, Del Vista's lease
 *  addendum) — see /admin/association-document-setup. Merged into the
 *  fixed compliance-taxonomy required-items list for that association only. */
export async function getCustomRequirements(assoc: string): Promise<CustomRequirement[]> {
  const { data } = await supabaseAdmin.from('association_document_requirements')
    .select('item_key, label, occupancy_filter').eq('association_code', assoc).eq('active', true)
  return (data ?? []).map(r => ({ itemKey: r.item_key as string, label: r.label as string, occupancyFilter: (r.occupancy_filter as Occupancy | null) ?? null }))
}

/** This unit's occupancy + which required documents are still missing. */
export async function getUnitComplianceState(assoc: string, unitRef: string): Promise<{ occupancy: Occupancy | null; kind: AssocKind; commercialUseType: string | null; missing: MissingItem[] }> {
  const [{ data: occ }, { data: recs }, kind, custom] = await Promise.all([
    supabaseAdmin.from('unit_occupancy').select('status, commercial_use_type').eq('association_code', assoc).eq('unit_ref', unitRef).maybeSingle(),
    supabaseAdmin.from('compliance_records').select('item_key, status, declared_type').eq('association_code', assoc).eq('scope', 'unit').eq('unit_ref', unitRef),
    associationKind(assoc),
    getCustomRequirements(assoc),
  ])
  const occupancy = (occ?.status as Occupancy | undefined) ?? null
  const onFile = onFileSet(recs)
  const declaredByKey = new Map((recs ?? []).map(r => [r.item_key as string, r.declared_type as string | null]))
  const customLabelByKey = new Map(custom.map(c => [c.itemKey, c.label]))
  const customKeys = custom.filter(c => c.occupancyFilter === null || c.occupancyFilter === occupancy).map(c => c.itemKey)
  const allKeys = [...requiredItemKeys(kind, occupancy), ...customKeys]
  const missing = allKeys.filter(k => !onFile.has(k)).map(k => ({ key: k, label: customLabelByKey.get(k) ?? labelFor(k), declaredType: declaredByKey.get(k) ?? null }))
  return { occupancy, kind, commercialUseType: (occ?.commercial_use_type as string | null) ?? null, missing }
}

/** What a TENANT must provide, by association kind (commercial → CGL+COI). */
export async function getTenantComplianceState(assoc: string, unitRef: string): Promise<{ missing: MissingItem[]; commercial: boolean }> {
  const [{ data: recs }, kind] = await Promise.all([
    supabaseAdmin.from('compliance_records').select('item_key, status, declared_type').eq('association_code', assoc).eq('scope', 'unit').eq('unit_ref', unitRef),
    associationKind(assoc),
  ])
  const commercial = kind === 'commercial'
  // Access Control is an internal/office-issued item (not owner/tenant-provided).
  // Usage Type is commercial-only; Pet Registration is residential-only.
  const required = ['unit.tenant', 'unit.vehicle', 'unit.rules_ack', 'unit.leasing', commercial ? 'unit.cgl' : 'unit.ho4']
  required.push(commercial ? 'unit.usage_type' : 'unit.pet')
  const onFile = onFileSet(recs)
  const declaredByKey = new Map((recs ?? []).map(r => [r.item_key as string, r.declared_type as string | null]))
  return { missing: required.filter(k => !onFile.has(k)).map(k => ({ key: k, label: labelFor(k), declaredType: declaredByKey.get(k) ?? null })), commercial }
}

export async function setUnitOccupancy(assoc: string, unitRef: string, status: Occupancy, updatedBy: string): Promise<void> {
  await supabaseAdmin.from('unit_occupancy').upsert(
    { association_code: assoc, unit_ref: unitRef, status, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'association_code,unit_ref' },
  )
}

/** unit_occupancy.status is NOT NULL — a use-type save can't create a row
 *  from scratch (there'd be no occupancy value to put in it), only update
 *  one that already exists. Returns false when the owner hasn't picked
 *  occupancy yet, so the caller can ask for that first. */
export async function setCommercialUseType(assoc: string, unitRef: string, useType: string, updatedBy: string): Promise<boolean> {
  const { data: existing } = await supabaseAdmin.from('unit_occupancy')
    .select('id').eq('association_code', assoc).eq('unit_ref', unitRef).maybeSingle()
  if (!existing) return false
  await supabaseAdmin.from('unit_occupancy')
    .update({ commercial_use_type: useType, updated_by: updatedBy, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
  return true
}

/** Self-reported insurance-type dropdown for a specific item — stored on
 *  compliance_records without disturbing an existing status (declaring a
 *  type is metadata about intent, not the same as the document being on
 *  file/reviewed). Inserts a 'missing' placeholder row only if none exists. */
export async function setDeclaredType(assoc: string, unitRef: string, itemKey: string, declaredType: string, updatedBy: string): Promise<void> {
  const { data: existing } = await supabaseAdmin.from('compliance_records')
    .select('id').eq('association_code', assoc).eq('scope', 'unit').eq('unit_ref', unitRef).eq('item_key', itemKey).maybeSingle()
  if (existing) {
    await supabaseAdmin.from('compliance_records').update({ declared_type: declaredType, updated_by: updatedBy }).eq('id', existing.id)
  } else {
    await supabaseAdmin.from('compliance_records').insert({
      scope: 'unit', association_code: assoc, unit_ref: unitRef, item_key: itemKey,
      applicable: true, status: 'missing', declared_type: declaredType, updated_by: updatedBy,
    })
  }
}
