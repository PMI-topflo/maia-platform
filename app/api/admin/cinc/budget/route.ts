// =====================================================================
// app/api/admin/cinc/budget/route.ts
// GET /api/admin/cinc/budget?assoc=KANE — returns the GL options for
// the invoice intake dropdown, fetched from CINC's
// /accounting/budget/association/{assocCode}. Cached server-side for
// 30 min (see lib/integrations/cinc.ts getAssociationBudget).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getAssociationBudget, listGlTransactionsByDate } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

// CINC's budget endpoint returns $0 for budget + actual on associations whose
// budget isn't entered, so the dropdown showed every line as "$0 left of $0".
// Compute the REAL year-to-date spend per expense GL from the ledger so Karen
// always sees a useful amount ("$X spent this year"). Cached 30 min per assoc.
const _spendCache = new Map<string, { map: Map<string, number>; expiresAt: number }>()
async function ytdSpendByGl(assoc: string, force: boolean): Promise<Map<string, number>> {
  const key = assoc.toUpperCase()
  if (!force) { const hit = _spendCache.get(key); if (hit && hit.expiresAt > Date.now()) return hit.map }
  const map = new Map<string, number>()
  try {
    const yr = new Date().getUTCFullYear()
    const txns = await listGlTransactionsByDate({ assocCode: assoc, fromDate: `${yr}-01-01`, toDate: new Date().toISOString().slice(0, 10) })
    // In this CINC ledger, expense activity posts as a NEGATIVE DebitAmount on
    // the expense GL (e.g. "Inv.#5579 - Plumbing" → 61-6200-00, debit −385), so
    // the spent amount is the negated debit. Sum signed so reversals net out.
    for (const t of txns) {
      const n = (t.AccountNumber ?? '').trim()
      const amt = -(t.DebitAmount ?? 0)
      if (n && amt !== 0) map.set(n, (map.get(n) ?? 0) + amt)
    }
  } catch { /* leave empty — dropdown still works, just no spent context */ }
  _spendCache.set(key, { map, expiresAt: Date.now() + 30 * 60 * 1000 })
  return map
}

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url   = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim()
  const force = url.searchParams.get('refresh') === '1'
  if (!assoc) return NextResponse.json({ error: 'assoc query param required' }, { status: 400 })

  try {
    const all = await getAssociationBudget(assoc, { forceRefresh: force })
    // CINC's budget endpoint returns the full chart of accounts. Karen is
    // picking the expense category for an invoice, so include EVERY
    // expense-range GL account — she must always be able to categorize an
    // invoice, even for an association whose CINC budget isn't loaded yet, or
    // for a legitimate expense category that has no budget/activity so far.
    // (We previously also required budget-or-activity, which left some
    // associations with an empty dropdown and no way to pick a GL at all.)
    // Two principled exclusions remain; in-use lines sort to the top.
    const hasActivity = (l: { budget: number | null; actual: number | null }) =>
      (l.budget != null && l.budget > 0) || (l.actual != null && Math.abs(l.actual) > 0)
    const spent = await ytdSpendByGl(assoc, force)
    const lines = all
      .filter(l => {
        const firstDigit = parseInt(l.number?.[0] ?? '', 10)
        // GL number prefix 5–9 — expenses + reserve transfers (fund-accounting).
        const isExpenseRange = firstDigit >= 5 && firstDigit <= 9
        // Reserve / Special Assessment lines are a funding-source decision,
        // not an expense category — the payment source is picked separately.
        const isReserveOrSA = /\breserve|special\s*assess/i.test(l.name)
        // Transitional / historical / orphan accounts that hold real actual
        // but aren't a category to pick for new invoices (prior-management
        // cleanup, orphan admin fees — reclassified separately).
        const isExcludedHistorical = /\bprior\s*m(gm)?t\b|\bprior\s*management\b|\badministrative\s*fees?\b/i.test(l.name)
        return isExpenseRange && !isReserveOrSA && !isExcludedHistorical
      })
      // Fill in the real YTD spend from the ledger when CINC's Actual is empty,
      // and recompute remaining when there's a budget. Gives every line a useful
      // amount instead of "$0 left of $0".
      .map(l => {
        const ytd    = (l.number ? spent.get(l.number) : 0) ?? 0
        const actual = (l.actual != null && Math.abs(l.actual) > 0) ? l.actual : (ytd > 0 ? ytd : null)
        const remaining = (l.budget != null && l.budget > 0) ? l.budget - (actual ?? 0) : l.remaining
        return { ...l, actual, remaining }
      })
      // In-use lines (budget or YTD activity) first, then the rest of the
      // expense chart of accounts — each ordered by GL number.
      .sort((a, b) => {
        const ua = hasActivity(a) ? 0 : 1
        const ub = hasActivity(b) ? 0 : 1
        if (ua !== ub) return ua - ub
        return (a.number ?? '').localeCompare(b.number ?? '', undefined, { numeric: true })
      })
    return NextResponse.json({ assoc: assoc.toUpperCase(), lines })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC budget fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
