// =====================================================================
// app/api/admin/cinc/funds-check/route.ts
//
// GET /api/admin/cinc/funds-check?assoc=X&account=Y&scheduled=YYYY-MM-DD&push=N
//   "Will <account> have funds on the scheduled payment date?" — projects
//   the balance to the END OF THE SCHEDULED MONTH using ALL open invoices
//   plus the account's average monthly net flow, and returns a 6-month
//   horizon so the intake card can suggest the earliest affordable month.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { forecastFundsForDate } from '@/lib/cash-flow-forecast'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url       = new URL(req.url)
  const assoc     = (url.searchParams.get('assoc') ?? '').trim()
  const acct      = url.searchParams.get('account')
  const scheduled = (url.searchParams.get('scheduled') ?? '').trim()
  const push      = parseFloat(url.searchParams.get('push') ?? '0')
  if (!assoc || !acct) {
    return NextResponse.json({ error: 'assoc + account query params required' }, { status: 400 })
  }
  const bankAccountId = parseInt(acct, 10)
  if (!Number.isFinite(bankAccountId)) {
    return NextResponse.json({ error: 'account must be a number' }, { status: 400 })
  }

  try {
    const result = await forecastFundsForDate({
      assocCode:     assoc,
      bankAccountId,
      scheduledDate: scheduled || new Date().toISOString().slice(0, 10),
      pushAmount:    Number.isFinite(push) ? push : 0,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: `Funds check failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
