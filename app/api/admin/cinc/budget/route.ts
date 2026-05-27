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
    //     account the association actually uses).
    const lines = all.filter(l => {
      const firstDigit = parseInt(l.number?.[0] ?? '', 10)
      const isExpenseRange = firstDigit >= 5 && firstDigit <= 9
      const hasActivity =
        (l.budget != null && l.budget > 0) ||
        (l.actual != null && Math.abs(l.actual) > 0)
      // Reserve / Special Assessment lines are a funding-source decision,
      // not an expense category — Karen picks the expense GL (e.g. Roof
      // Repair) and the payment source is set separately.
      const isReserveOrSA = /\breserve|special\s*assess/i.test(l.name)
      return isExpenseRange && hasActivity && !isReserveOrSA
    })
    return NextResponse.json({ assoc: assoc.toUpperCase(), lines })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC budget fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
