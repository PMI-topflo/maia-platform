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
    // CINC's budget endpoint returns the full chart of accounts. Karen
    // is picking the expense category for an invoice, so narrow to:
    //   - GL number prefix 5–9 (expenses + reserve transfers per the
    //     standard fund-accounting convention), AND
    //   - has either a budget allocation or YTD activity (i.e. an
    //     account the association actually uses) OR is on the
    //     "always-include" list (see below), AND
    //   - is not a Reserve / Special Assessment expense line (funding
    //     source decision handled by the bank-account picker).
    const lines = all.filter(l => {
      const firstDigit = parseInt(l.number?.[0] ?? '', 10)
      const isExpenseRange = firstDigit >= 5 && firstDigit <= 9
      const hasActivity =
        (l.budget != null && l.budget > 0) ||
        (l.actual != null && Math.abs(l.actual) > 0)
      // Always-include exception: "Project Work" runs at $0 budget by
      // board design across the VP family (and possibly other assocs).
      // Project invoices get paid from the reserve account via the bank
      // picker, but Karen still needs the GL line available regardless
      // of activity. Without this, the line is hidden until activity
      // accumulates — too late to categorize the first invoice.
      const isAlwaysIncluded = /\bproject\s*work\b/i.test(l.name)
      // Reserve / Special Assessment lines are a funding-source decision,
      // not an expense category — Karen picks the expense GL (e.g. Roof
      // Repair) and the payment source is set separately.
      const isReserveOrSA = /\breserve|special\s*assess/i.test(l.name)
      // Excluded transitional / historical / orphan accounts that hold
      // real actual but aren't in any association's board-approved
      // budget. Karen should never pick these for new invoices —
      // Jonathan/Shemaiah will reclassify the orphan balances separately.
      //   - "Prior Mgmt - Unknown Items" — DELA, from a management-company
      //     transition ($131K+ historical actual).
      //   - "Administrative Fees" — ONE only as of 2026-05-27; $5,790
      //     orphan with no budget line in ONE's approved 2026 budget.
      //     Currently exclusive to ONE in the platform; if another assoc
      //     starts using this name legitimately, narrow the pattern.
      const isExcludedHistorical = /\bprior\s*m(gm)?t\b|\bprior\s*management\b|\badministrative\s*fees?\b/i.test(l.name)
      return isExpenseRange && (hasActivity || isAlwaysIncluded) && !isReserveOrSA && !isExcludedHistorical
    })
    return NextResponse.json({ assoc: assoc.toUpperCase(), lines })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC budget fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
