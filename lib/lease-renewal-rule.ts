// =====================================================================
// lib/lease-renewal-rule.ts
//
// The 30-day renewal grace window (decided 2026-09-01, "Option 2" in
// docs/ROADMAP.md; reaffirmed by the user 2026-09-12 for Manors XI: "does
// not re-screen on renewals, only if the renewal was not requested until
// 30 days after expired").
//
//   A lease renewal requested on or before the previous lease's end date
//   + 30 days is a lightweight `lease_renewal` — no new screening, no new
//   application fee.
//   Requested later than that, it is a NEW LEASE: full checklist, fresh
//   screening, application fee. The person still picks "renewal"; MAIA
//   opens it as a lease and says why.
//
// The previous lease end comes from the unit's tenant record
// (unit_tenant_contacts.lease_end, keyed by CINC account) and, failing
// that, from the signed lease on the unit's most recent approved
// application. With no lease end on file at all, the renewal is taken at
// face value — MAIA never punishes a unit for missing data.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnit } from '@/lib/application-delinquency-notice'

export const RENEWAL_GRACE_DAYS = 30

export interface RenewalRuling {
  type: 'lease_renewal' | 'lease'
  leaseEnd: string | null
  daysAfterEnd: number | null
  /** Plain-English reason when the renewal was turned into a new lease. */
  notice: string | null
}

/** The end date of the unit's current / most recent lease, YYYY-MM-DD, or null. */
export async function previousLeaseEnd(associationCode: string, unitLabel: string): Promise<string | null> {
  const code = associationCode.toUpperCase()
  try {
    const { accountNumber } = await resolveUnit(code, unitLabel)
    if (accountNumber) {
      const { data } = await supabaseAdmin.from('unit_tenant_contacts').select('lease_end').eq('association_code', code).eq('unit_ref', accountNumber).maybeSingle()
      if (data?.lease_end) return String(data.lease_end).slice(0, 10)
    }
  } catch { /* fall through */ }
  const { data: apps } = await supabaseAdmin.from('listing_applications').select('id')
    .eq('association_code', code).eq('unit_label', unitLabel).in('application_type', ['lease', 'lease_renewal']).eq('status', 'approved')
    .order('created_at', { ascending: false }).limit(3)
  for (const a of apps ?? []) {
    const { data: doc } = await supabaseAdmin.from('application_documents').select('expiration_date')
      .eq('application_id', a.id).eq('doc_key', 'signed_lease').not('expiration_date', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (doc?.expiration_date) return String(doc.expiration_date).slice(0, 10)
  }
  return null
}

const fmt = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/** Decide whether a requested renewal is still a renewal today. */
export async function ruleOnRenewal(associationCode: string, unitLabel: string | null, today = new Date()): Promise<RenewalRuling> {
  if (!unitLabel) return { type: 'lease_renewal', leaseEnd: null, daysAfterEnd: null, notice: null }
  const leaseEnd = await previousLeaseEnd(associationCode, unitLabel)
  if (!leaseEnd) return { type: 'lease_renewal', leaseEnd: null, daysAfterEnd: null, notice: null }
  const end = new Date(leaseEnd + 'T23:59:59-04:00').getTime()
  const days = Math.floor((today.getTime() - end) / 86400000)
  if (days <= RENEWAL_GRACE_DAYS) return { type: 'lease_renewal', leaseEnd, daysAfterEnd: days, notice: null }
  return {
    type: 'lease', leaseEnd, daysAfterEnd: days,
    notice: `The previous lease for this unit ended on ${fmt(leaseEnd)}, ${days} days ago — more than ${RENEWAL_GRACE_DAYS} days. Per the Association's rule this is treated as a new lease application: full document checklist, background screening and the application fee apply.`,
  }
}
