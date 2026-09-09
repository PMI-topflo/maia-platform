// =====================================================================
// GET /api/owner/ledger/[token]
//
// Login-free PDF account statement for an owner. The token (HMAC, 7-day TTL)
// encodes { assoc, account } and is handed out only after the owner confirmed
// their unit + passed the one-time verification in the WhatsApp/SMS/voice
// flow. Pulls the live CINC ledger, filters to the statement window, renders
// the branded PDF, and streams it back.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyLedgerToken } from '@/lib/owner-portal-token'
import { getHomeownerLedger } from '@/lib/integrations/cinc'
import { ledgerDateRange, normalizeLedger, renderLedgerPdf } from '@/lib/owner-ledger'
import { findMergedOwner } from '@/lib/owner-lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyLedgerToken(token)
  if (!data) {
    return new NextResponse('This statement link has expired or is invalid. Please request a new one.', { status: 401 })
  }

  // Owner display details (best-effort; the token already authorizes access).
  const o = await findMergedOwner(data.assoc, data.account)

  const range = ledgerDateRange()
  const rows  = await getHomeownerLedger({ assocCode: data.assoc, hoId: data.account, fromDate: range.fromDate, toDate: range.toDate })
  const lines = normalizeLedger(rows, range.fromDate, range.toDate)

  const pdf = await renderLedgerPdf({
    ownerName: o?.name || 'Owner',
    unit:        o?.unitNumber ?? null,
    address:     o?.address ?? null,
    association: o?.associationName || data.assoc,
    periodLabel: range.label,
    generatedOn: range.toDate,
  }, lines)

  const filename = `Statement-${data.account}-${range.toDate}.pdf`
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control':       'private, no-store',
    },
  })
}
