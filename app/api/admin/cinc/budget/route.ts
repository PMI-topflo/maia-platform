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
import { getAssociationBudget } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

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
