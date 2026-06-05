// =====================================================================
// app/api/admin/reconciliation/done/route.ts
//
// POST — the "Done for today" button. Rolls up everything the logged-in
// staffer reconciled / marked paid today (across ALL associations) into
// their single daily reconciliation ticket and marks it resolved. One
// ticket per staffer per day; safe to click more than once (the summary
// is recomputed from the ledger, never incremented).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { refreshReconTicketSummary } from '@/lib/reconciliation-tickets'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const email = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null
  if (!email) return NextResponse.json({ error: 'No staff email on session' }, { status: 401 })

  const r = await refreshReconTicketSummary({ staffEmail: email, resolve: true })
  if (!r) return NextResponse.json({ error: 'Could not create or update the daily ticket' }, { status: 500 })

  return NextResponse.json({
    ok: true,
    ticketNumber: r.ticketNumber,
    totalReconciled: r.totalRec,
    totalPaid: r.totalPaid,
    summary: r.summary,
  })
}
