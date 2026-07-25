// =====================================================================
// lib/association-audit.ts
//
// Shared per-unit audit computation: occupancy + which compliance
// documents a unit has vs. still needs. Extracted from the staff
// /api/admin/unit-status route so the board/manager unit-audit portal
// (app/api/units/audit) and the staff dashboard compute identically.
//
// Pass an associationCode to scope to one association (the portal case,
// ~hundreds of units); omit it for the whole portfolio (staff case,
// 1000+ units — pages through PostgREST's ~1000-row cap).
//
// account_number ("unit_ref") is the true unique unit key — NOT
// unit_number, which a commercial association can reuse across distinct
// accounts. See the long note in the old unit-status route.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { requiredItemKeys, itemLabel, type AssocKind, type Occupancy } from '@/lib/unit-required-docs'

export function kindFromType(type: string | null): AssocKind {
  const t = String(type ?? '').toLowerCase()
  if (t.includes('commercial')) return 'commercial'
  if (t.includes('hoa')) return 'hoa'
  if (t.includes('coop')) return 'coop'
  return 'condo'
}

/** Derive {floor, line} from a numeric unit number (floor×100 + line,
 *  e.g. 1013 → floor 10 line 13; 101 → floor 1 line 01). Non-numeric
 *  unit labels return nulls (no floor-plan placement). */
export function floorLine(unitNumber: string | null): { floor: number | null; line: number | null } {
  const s = String(unitNumber ?? '').trim()
  if (!/^\d{3,4}$/.test(s)) return { floor: null, line: null }
  const n = parseInt(s, 10)
  return { floor: Math.floor(n / 100), line: n % 100 }
}

export interface AuditUnit {
  associationCode: string
  associationName: string | null
  accountNumber:   string
  unit:            string | null   // display unit_number
  floor:           number | null
  line:            number | null
  ownerName:       string
  occupancy:       Occupancy | null
  kind:            AssocKind
  tenantName:      string | null
  leaseEndDate:    string | null
  requiredKeys:    string[]
  onFileKeys:      string[]
  missing:         { key: string; label: string }[]
  missingCount:    number
}

const PAGE_SIZE = 1000

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const { data } = await build(from, from + PAGE_SIZE - 1)
    const page = data ?? []
    out.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}

/** One audit row per unit. Scope to `associationCode` for the portal;
 *  omit for the whole portfolio. */
export async function buildAssociationAudit(associationCode?: string): Promise<AuditUnit[]> {
  const scope = associationCode?.toUpperCase()
  // Optionally narrow a query to one association. Typed loosely on purpose:
  // constraining B to the PostgREST builder shape blows up TS2589 (the
  // builder's own types are already deeply recursive).
  function scoped<Q>(q: Q): Q {
    return scope ? (q as unknown as { eq(c: string, v: string): Q }).eq('association_code', scope) : q
  }

  const [assocs, owners, occ, tenants, recs, customReqs] = await Promise.all([
    fetchAll<{ association_code: string; association_type: string | null }>((from, to) =>
      scoped(supabaseAdmin.from('associations').select('association_code, association_type')).range(from, to)),
    fetchAll<{ account_number: string | null; association_code: string; association_name: string | null; unit_number: string | null; first_name: string | null; last_name: string | null; entity_name: string | null }>((from, to) =>
      scoped(supabaseAdmin.from('owners')
        .select('account_number, association_code, association_name, unit_number, first_name, last_name, entity_name')
        .or('status.neq.previous,status.is.null')).range(from, to)),
    fetchAll<{ association_code: string; unit_ref: string; status: string }>((from, to) =>
      scoped(supabaseAdmin.from('unit_occupancy').select('association_code, unit_ref, status')).range(from, to)),
    fetchAll<{ association_code: string; unit_number: string; first_name: string | null; last_name: string | null; lease_end_date: string | null }>((from, to) =>
      scoped(supabaseAdmin.from('association_tenants')
        .select('association_code, unit_number, first_name, last_name, lease_end_date').eq('status', 'active')).range(from, to)),
    fetchAll<{ association_code: string; unit_ref: string; item_key: string; status: string }>((from, to) =>
      scoped(supabaseAdmin.from('compliance_records').select('association_code, unit_ref, item_key, status').eq('scope', 'unit')).range(from, to)),
    fetchAll<{ association_code: string; item_key: string; occupancy_filter: string | null }>((from, to) =>
      scoped(supabaseAdmin.from('association_document_requirements').select('association_code, item_key, occupancy_filter').eq('active', true)).range(from, to)),
  ])

  const kindByAssoc = new Map<string, AssocKind>(assocs.map(a => [String(a.association_code), kindFromType(a.association_type)]))
  const customReqsByAssoc = new Map<string, { itemKey: string; occupancyFilter: Occupancy | null }[]>()
  for (const c of customReqs) {
    if (!customReqsByAssoc.has(c.association_code)) customReqsByAssoc.set(c.association_code, [])
    customReqsByAssoc.get(c.association_code)!.push({ itemKey: c.item_key, occupancyFilter: (c.occupancy_filter as Occupancy | null) ?? null })
  }
  const key = (assoc: string | null, ref: string | null) => `${assoc ?? ''}::${ref ?? ''}`

  const occByUnit = new Map<string, Occupancy>()
  for (const o of occ) occByUnit.set(key(o.association_code, o.unit_ref), o.status as Occupancy)

  const tenantByUnit = new Map<string, { name: string; leaseEndDate: string | null }>()
  for (const t of tenants) {
    const name = [t.first_name, t.last_name].filter(Boolean).join(' ')
    tenantByUnit.set(key(t.association_code, t.unit_number), { name, leaseEndDate: t.lease_end_date })
  }

  const onFileByUnit = new Map<string, Set<string>>()
  for (const r of recs) {
    if (r.status === 'missing' || r.status === 'na') continue
    const k = key(r.association_code, r.unit_ref)
    if (!onFileByUnit.has(k)) onFileByUnit.set(k, new Set())
    onFileByUnit.get(k)!.add(r.item_key)
  }

  const unitsByKey = new Map<string, { associationCode: string; associationName: string | null; accountNumber: string; unitNumber: string | null; ownerNames: string[] }>()
  for (const o of owners) {
    if (!o.account_number) continue
    const k = key(o.association_code, o.account_number)
    const name = o.entity_name || [o.first_name, o.last_name].filter(Boolean).join(' ')
    const existing = unitsByKey.get(k)
    if (existing) { if (name && !existing.ownerNames.includes(name)) existing.ownerNames.push(name) }
    else unitsByKey.set(k, { associationCode: o.association_code, associationName: o.association_name, accountNumber: o.account_number, unitNumber: o.unit_number, ownerNames: name ? [name] : [] })
  }

  return [...unitsByKey.values()].map(u => {
    const k = key(u.associationCode, u.accountNumber)
    const occupancy = occByUnit.get(k) ?? null
    const kind = kindByAssoc.get(u.associationCode) ?? 'condo'
    const customKeys = (customReqsByAssoc.get(u.associationCode) ?? [])
      .filter(c => c.occupancyFilter === null || c.occupancyFilter === occupancy).map(c => c.itemKey)
    const requiredKeys = [...new Set([...requiredItemKeys(kind, occupancy), ...customKeys])]
    const onFile = onFileByUnit.get(k) ?? new Set<string>()
    const missing = requiredKeys.filter(rk => !onFile.has(rk)).map(rk => ({ key: rk, label: itemLabel(rk) }))
    const tenant = occupancy === 'leased' ? tenantByUnit.get(key(u.associationCode, u.unitNumber)) : undefined
    const { floor, line } = floorLine(u.unitNumber)
    return {
      associationCode: u.associationCode,
      associationName: u.associationName,
      accountNumber:   u.accountNumber,
      unit:            u.unitNumber,
      floor, line,
      ownerName:       u.ownerNames.join(' & '),
      occupancy,
      kind,
      tenantName:      tenant?.name ?? null,
      leaseEndDate:    tenant?.leaseEndDate ?? null,
      requiredKeys,
      onFileKeys:      [...onFile],
      missing,
      missingCount:    missing.length,
    }
  })
}
