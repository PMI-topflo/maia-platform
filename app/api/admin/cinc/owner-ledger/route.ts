// =====================================================================
// GET /api/admin/cinc/owner-ledger?assoc=ABBOTT&account=ABBOTT1[&from=&to=]
//
// Staff-only PROBE for the owner-ledger self-service feature. Pulls a real
// homeowner ledger from CINC so we can confirm the endpoint, the date params,
// and the response field names against production before wiring the
// WhatsApp/text/voice owner flow. Read-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getHomeownerLedger } from '@/lib/integrations/cinc'
import { ledgerDateRange } from '@/lib/owner-ledger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url     = new URL(req.url)
  const assoc   = (url.searchParams.get('assoc') ?? '').trim()
  const account = (url.searchParams.get('account') ?? '').trim()
  if (!assoc || !account) {
    return NextResponse.json({ error: 'assoc and account (owners.account_number) are required' }, { status: 400 })
  }

  const range = ledgerDateRange()
  const fromDate = url.searchParams.get('from')?.trim() || range.fromDate
  const toDate   = url.searchParams.get('to')?.trim()   || range.toDate

  try {
    const rows = await getHomeownerLedger({ assocCode: assoc, hoId: account, fromDate, toDate })
    return NextResponse.json({
      ok: true,
      assoc, account, fromDate, toDate, label: range.label,
      count: rows.length,
      // First row's keys make the real field names obvious at a glance.
      sampleKeys: rows[0] ? Object.keys(rows[0]) : [],
      rows,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
