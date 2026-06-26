// =====================================================================
// lib/owner-ledger.ts
// Helpers for the owner "send me my ledger" self-service flow.
// =====================================================================

/** The date window for a ledger request: the entire current year so far, or —
 *  in January, when YTD is nearly empty — the last 3 months instead. Returns
 *  ISO 'YYYY-MM-DD' bounds + a human label. Stays within CINC's 366-day cap. */
export function ledgerDateRange(today: Date = new Date()): { fromDate: string; toDate: string; label: string } {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() // 0 = January
  const toDate = today.toISOString().slice(0, 10)

  if (m === 0) {
    // January → last 3 months (Nov 1 of the prior year through today).
    const from = new Date(Date.UTC(y, m - 2, 1)) // m-2 = -2 → November of y-1
    return { fromDate: from.toISOString().slice(0, 10), toDate, label: 'the last 3 months' }
  }
  return { fromDate: `${y}-01-01`, toDate, label: `${y} (year to date)` }
}
