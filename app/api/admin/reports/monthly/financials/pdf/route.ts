// =====================================================================
// GET /api/admin/reports/monthly/financials/pdf?assoc=&month=
//
// Streams the financial-statement PDF on file for an (association,
// month) — the "attached" statement linked from the report builder and
// the monthly-report view. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getFinancials, downloadFinancialPdf } from '@/lib/report-financials'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const assoc = (searchParams.get('assoc') ?? '').trim().toUpperCase()
  const month = (searchParams.get('month') ?? '').trim()
  if (!assoc || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'assoc and month are required' }, { status: 400 })
  }

  const row = await getFinancials(assoc, month)
  if (!row) {
    return NextResponse.json({ error: 'No financial statement on file' }, { status: 404 })
  }

  const bytes = await downloadFinancialPdf(row.storage_path)
  if (!bytes) {
    return NextResponse.json({ error: 'Could not load the statement PDF' }, { status: 500 })
  }

  const fileName = (row.pdf_filename || `Financial Statement ${assoc} ${month}.pdf`)
    .replace(/[^\w.\- ]/g, '')

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control':       'no-store',
    },
  })
}
