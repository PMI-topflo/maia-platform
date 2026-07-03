// =====================================================================
// lib/vendor-compliance-overview.ts
//
// Powers the /admin/vendor-compliance audit page + its Control Panel card.
// Lists the vendors that have CURRENT (active) work orders and, for each,
// reads their CINC compliance state (ACH / W-9 / COI / license + expiry).
// Files are loaded separately (lazily, on expand) by the files endpoint to
// keep this read light.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getVendorComplianceStatus, type VendorComplianceStatus } from '@/lib/integrations/cinc'
import { loadCoiVerdict, getCoiExemption } from '@/lib/coi-verdict'
import type { CoiVerdict } from '@/lib/coi-validation'

const ACTIVE_WO_STATUSES = ['open', 'pending', 'waiting_external'] as const

export interface ActiveWorkOrderVendor {
  key:           string        // stable grouping key (CINC id, else lower(name))
  vendorId:      number | null // CINC VendorId when linked
  vendorName:    string
  vendorEmail:   string | null
  assocCode:     string | null // representative association (first active WO)
  ticketIds:     number[]
  ticketNumbers: string[]
  repTicketId:   number        // representative ticket for the upload link
}

/** Distinct vendors that have at least one active work order. No CINC calls —
 *  cheap enough for the Control Panel card. */
export async function getActiveWorkOrderVendors(): Promise<ActiveWorkOrderVendor[]> {
  const { data: tickets } = await supabaseAdmin.from('tickets')
    .select('id, ticket_number, association_code')
    .eq('type', 'work_order')
    .in('status', ACTIVE_WO_STATUSES as unknown as string[])
    .order('id', { ascending: false })
    .limit(500)
  const rows = (tickets ?? []) as { id: number; ticket_number: string | null; association_code: string | null }[]
  if (rows.length === 0) return []
  const ticketById = new Map(rows.map(t => [t.id, t]))

  const { data: details } = await supabaseAdmin.from('work_order_details')
    .select('ticket_id, cinc_vendor_id, vendor_name, vendor_email')
    .in('ticket_id', rows.map(t => t.id))
  const wod = (details ?? []) as { ticket_id: number; cinc_vendor_id: number | null; vendor_name: string | null; vendor_email: string | null }[]

  const byVendor = new Map<string, ActiveWorkOrderVendor>()
  for (const d of wod) {
    const name = (d.vendor_name ?? '').trim()
    if (!name && d.cinc_vendor_id == null) continue           // unassigned WO — skip
    const key = d.cinc_vendor_id != null ? `id:${d.cinc_vendor_id}` : `name:${name.toLowerCase()}`
    const t = ticketById.get(d.ticket_id)
    if (!t) continue
    let v = byVendor.get(key)
    if (!v) {
      v = {
        key, vendorId: d.cinc_vendor_id != null ? Number(d.cinc_vendor_id) : null,
        vendorName: name || `Vendor ${d.cinc_vendor_id}`, vendorEmail: null,
        assocCode: t.association_code ?? null, ticketIds: [], ticketNumbers: [], repTicketId: d.ticket_id,
      }
      byVendor.set(key, v)
    }
    v.ticketIds.push(d.ticket_id)
    if (t.ticket_number) v.ticketNumbers.push(t.ticket_number)
    if (!v.vendorEmail && d.vendor_email && d.vendor_email.includes('@')) v.vendorEmail = d.vendor_email.trim()
    if (!v.assocCode && t.association_code) v.assocCode = t.association_code
  }
  return Array.from(byVendor.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName))
}

/** Count for the Control Panel card — distinct vendors on active work orders. */
export async function countActiveWorkOrderVendors(): Promise<number> {
  try { return (await getActiveWorkOrderVendors()).length } catch { return 0 }
}

export interface VendorComplianceRow extends ActiveWorkOrderVendor {
  /** null when the vendor isn't linked to a CINC record (can't be checked). */
  compliance: VendorComplianceStatus | null
  linked:     boolean
  /** Self-service deep-link keys for the items missing/expired (ach/w9). */
  needKeys:   ('ach' | 'w9')[]
  /** Human labels for everything missing/expired (incl. COI/license). */
  missing:    string[]
  /** Deep COI verdict (additional-insured + expiry) from our stored COI, or
   *  null when no COI attachment exists on these work orders. */
  coiVerdict: CoiVerdict | null
  /** Staff-declared exemption from the invoice-push COI guard, if any. */
  coiExemptReason: string | null
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  })
  await Promise.all(workers)
  return out
}

function gaps(c: VendorComplianceStatus | null): { needKeys: ('ach' | 'w9')[]; missing: string[] } {
  if (!c) return { needKeys: [], missing: [] }
  const needKeys: ('ach' | 'w9')[] = []
  const missing: string[] = []
  if (!c.ach.onFile) { needKeys.push('ach'); missing.push('Direct-deposit (ACH) banking form') }
  if (!c.w9.onFile) { needKeys.push('w9'); missing.push('W-9 / tax form') }
  if (!c.coi.onFile) missing.push('Certificate of Insurance (COI)')
  else if (c.coi.valid === false) missing.push('Certificate of Insurance (COI) — expired')
  if (!c.license.onFile) missing.push('Trade / business license')
  else if (c.license.valid === false) missing.push('Trade / business license — expired')
  return { needKeys, missing }
}

/** The full audit view: every active-WO vendor enriched with CINC compliance.
 *  Bounded concurrency keeps us well clear of CINC's rate limit. */
export async function loadVendorComplianceOverview(): Promise<VendorComplianceRow[]> {
  const vendors = await getActiveWorkOrderVendors()
  return mapPool(vendors, 4, async (v): Promise<VendorComplianceRow> => {
    const [compliance, coiVerdict, exemption] = await Promise.all([
      v.vendorId != null ? getVendorComplianceStatus(v.vendorId, v.assocCode).catch(() => null) : Promise.resolve(null),
      loadCoiVerdict(v.ticketIds, v.assocCode).catch(() => null),
      v.vendorId != null ? getCoiExemption(v.vendorId).catch(() => null) : Promise.resolve(null),
    ])
    const { needKeys, missing } = gaps(compliance)
    return { ...v, compliance, linked: v.vendorId != null, needKeys, missing, coiVerdict, coiExemptReason: exemption?.exempt ? (exemption.reason ?? 'Marked exempt') : null }
  })
}
