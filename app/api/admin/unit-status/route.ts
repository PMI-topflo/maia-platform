// =====================================================================
// GET /api/admin/unit-status   (staff-only)
// Portfolio-wide occupancy + lease-expiry + compliance-completeness view,
// one row per unit. Bulk-queries every source table once and computes
// per-unit state in memory (mirrors lib/unit-required-docs.ts's
// requiredItemKeys()/associationKind() logic without an N+1 DB call per
// unit — this portfolio has 1000+ units).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requiredItemKeys, type AssocKind, type Occupancy } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function kindFromType(type: string | null): AssocKind {
  const t = String(type ?? '').toLowerCase()
  if (t.includes('commercial')) return 'commercial'
  if (t.includes('hoa')) return 'hoa'
  if (t.includes('coop')) return 'coop'
  return 'condo'
}

const PAGE_SIZE = 1000

/** Supabase/PostgREST caps a single select at ~1000 rows — page through
 *  with .range() until a short page signals the end. Several of these
 *  tables (owners, compliance_records) exceed that cap for this portfolio. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
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

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [assocs, owners, occ, tenants, recs] = await Promise.all([
    fetchAll<{ association_code: string; association_type: string | null }>((from, to) =>
      supabaseAdmin.from('associations').select('association_code, association_type').range(from, to)),
    fetchAll<{ account_number: string | null; association_code: string; association_name: string | null; unit_number: string | null; first_name: string | null; last_name: string | null; entity_name: string | null }>((from, to) =>
      supabaseAdmin.from('owners')
        .select('account_number, association_code, association_name, unit_number, first_name, last_name, entity_name')
        .or('status.neq.previous,status.is.null').range(from, to)),
    fetchAll<{ association_code: string; unit_ref: string; status: string }>((from, to) =>
      supabaseAdmin.from('unit_occupancy').select('association_code, unit_ref, status').range(from, to)),
    fetchAll<{ association_code: string; unit_number: string; first_name: string | null; last_name: string | null; lease_end_date: string | null }>((from, to) =>
      supabaseAdmin.from('association_tenants')
        .select('association_code, unit_number, first_name, last_name, lease_end_date').eq('status', 'active').range(from, to)),
    fetchAll<{ association_code: string; unit_ref: string; item_key: string; status: string }>((from, to) =>
      supabaseAdmin.from('compliance_records').select('association_code, unit_ref, item_key, status').eq('scope', 'unit').range(from, to)),
  ])

  const kindByAssoc = new Map<string, AssocKind>(assocs.map(a => [String(a.association_code), kindFromType(a.association_type)]))
  const key = (assoc: string | null, unit: string | null) => `${assoc ?? ''}::${unit ?? ''}`

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

  // Co-owned units have one owners row per co-owner — group into one row
  // per (association_code, unit_number) with owner names combined.
  const unitsByKey = new Map<string, { associationCode: string; associationName: string | null; unit: string | null; ownerNames: string[] }>()
  for (const o of owners) {
    const assocCode = o.association_code
    const unit = o.unit_number
    const k = key(assocCode, unit)
    const name = o.entity_name || [o.first_name, o.last_name].filter(Boolean).join(' ')
    const existing = unitsByKey.get(k)
    if (existing) { if (name && !existing.ownerNames.includes(name)) existing.ownerNames.push(name) }
    else unitsByKey.set(k, { associationCode: assocCode, associationName: o.association_name, unit, ownerNames: name ? [name] : [] })
  }

  const rows = [...unitsByKey.values()].map(u => {
    const k = key(u.associationCode, u.unit)
    const occupancy = occByUnit.get(k) ?? null
    const kind = kindByAssoc.get(u.associationCode) ?? 'condo'
    const required = requiredItemKeys(kind, occupancy)
    const onFile = onFileByUnit.get(k) ?? new Set<string>()
    const missingCount = required.filter(rk => !onFile.has(rk)).length
    const tenant = occupancy === 'leased' ? tenantByUnit.get(k) : undefined
    return {
      associationCode: u.associationCode,
      associationName: u.associationName,
      unit: u.unit,
      ownerName: u.ownerNames.join(' & '),
      occupancy,
      kind,
      tenantName: tenant?.name ?? null,
      leaseEndDate: tenant?.leaseEndDate ?? null,
      missingCount,
    }
  })

  return NextResponse.json({ rows })
}
