// GET /api/lease-packet/[token]/pdf
// The Agreement PDF for a lease packet, reached from the signer's link.
// Before both parties sign it is the review copy (blank signature blocks);
// after, it embeds the captured signatures + audit trail. Read-only.

import { renderToBuffer } from '@react-pdf/renderer'
import { verifyLeasePacketToken } from '@/lib/lease-packet-token'
import { getLeasePacket, agreementPropsFromPacket } from '@/lib/lease-packet'
import { LeasePacketAgreementPdf } from '@/lib/lease-packet-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyLeasePacketToken(token)
  if (!t) return new Response('This link has expired or is invalid.', { status: 401 })
  const p = await getLeasePacket(t.packetId)
  if (!p) return new Response('Not found.', { status: 404 })

  const pdf = await renderToBuffer(LeasePacketAgreementPdf(agreementPropsFromPacket(p)))
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Landlord-Tenant-Agreement-${p.unit_number ?? p.unit_ref}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
