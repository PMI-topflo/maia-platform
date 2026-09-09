// GET /api/units/ledger?account=MANXI707[&assoc=CODE]
// Branded PDF account statement for a unit, for the board/manager/staff
// audit portal. Same renderer as the owner self-service ledger — pulls the
// live CINC ledger, filters to the statement window, streams the PDF inline.
// Persona-gated (board | building_manager | unit_manager | staff), scoped
// to the caller's association (unit_manager narrowed to managed units).

import { NextResponse } from 'next/server'
import { getHomeownerLedger } from '@/lib/integrations/cinc'
import { ledgerDateRange, normalizeLedger, renderLedgerPdf } from '@/lib/owner-ledger'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { findMergedOwner } from '@/lib/owner-lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const account = (url.searchParams.get('account') || '').trim()
  const auth = await resolveUnitsAuth(url.searchParams.get('assoc'))
  if (!auth) return new NextResponse('Unauthorized', { status: 401 })
  if (!account) return new NextResponse('account required', { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return new NextResponse('Forbidden', { status: 403 })

  const o = await findMergedOwner(auth.assoc, account)

  const range = ledgerDateRange()
  const rows  = await getHomeownerLedger({ assocCode: auth.assoc, hoId: account, fromDate: range.fromDate, toDate: range.toDate })
  const lines = normalizeLedger(rows, range.fromDate, range.toDate)

  const pdf = await renderLedgerPdf({
    ownerName: o?.name || 'Owner',
    unit:        o?.unitNumber ?? null,
    address:     o?.address ?? null,
    association: o?.associationName || auth.assoc,
    periodLabel: range.label,
    generatedOn: range.toDate,
  }, lines)

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="Statement-${account}-${range.toDate}.pdf"`,
      'Cache-Control':       'private, no-store',
    },
  })
}
