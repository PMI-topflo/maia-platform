// =====================================================================
// app/api/admin/cinc/invoice-history/route.ts
//
// GET /api/admin/cinc/invoice-history?invoiceId=N
//   Returns the CINC audit trail for a single invoice (PENDING APPROVAL
//   → APPROVED → READY FOR PAYMENT → PAID, with who/when on each).
//   Used by the "Show history" affordance on pushed invoice cards.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listInvoiceHistory, listInvoicePayments } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const idStr = url.searchParams.get('invoiceId')
  const invoiceId = idStr ? parseInt(idStr, 10) : NaN
  if (!Number.isFinite(invoiceId)) {
    return NextResponse.json({ error: 'invoiceId query param required' }, { status: 400 })
  }

  // Fetch history + payments in parallel — the timeline view interleaves
  // them so Karen sees the full lifecycle (status changes + payments) in
  // one chronological list.
  try {
    const [history, payments] = await Promise.all([
      listInvoiceHistory(invoiceId),
      listInvoicePayments(invoiceId),
    ])
    return NextResponse.json({ invoiceId, history, payments })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
