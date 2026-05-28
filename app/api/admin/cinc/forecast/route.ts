// =====================================================================
// app/api/admin/cinc/forecast/route.ts
//
// GET /api/admin/cinc/forecast?assoc=X&account=Y
//   Returns end-of-month balance projection for one (assoc, bank
//   account) pair. Used by:
//     - the invoice intake card's Push affordance to warn before
//       overdrawing
//     - the reconciliation page's top stats card
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { forecastEndOfMonthBalance } from '@/lib/cash-flow-forecast'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url    = new URL(req.url)
  const assoc  = (url.searchParams.get('assoc') ?? '').trim()
  const acct   = url.searchParams.get('account')
  if (!assoc || !acct) {
    return NextResponse.json({ error: 'assoc + account query params required' }, { status: 400 })
  }
  const bankAccountId = parseInt(acct, 10)
  if (!Number.isFinite(bankAccountId)) {
    return NextResponse.json({ error: 'account must be a number' }, { status: 400 })
  }

  try {
    const forecast = await forecastEndOfMonthBalance({
      assocCode:     assoc,
      bankAccountId,
    })
    return NextResponse.json(forecast)
  } catch (err) {
    return NextResponse.json(
      { error: `Forecast failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
