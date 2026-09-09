// =====================================================================
// GET /api/owner/ach-form/[token]
//
// Login-free, MAIA-generated ACH authorization form (PDF) for an owner. The
// token (HMAC, 30-day TTL) encodes { assoc, account }; the form itself holds
// no sensitive data — it's blank for the owner to complete and return to
// ar@topfloridaproperties.com. Replaces handing out a Google Drive folder.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyAchToken } from '@/lib/owner-portal-token'
import { renderAchAuthorizationPdf } from '@/lib/ach-form'
import { listAssociationProperties } from '@/lib/integrations/cinc'
import { findMergedOwner } from '@/lib/owner-lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyAchToken(token)
  if (!data) {
    return new NextResponse('This ACH form link has expired or is invalid. Please request a new one.', { status: 401 })
  }

  const o = await findMergedOwner(data.assoc, data.account)

  // Contact info on file (email / phone / mailing) from CINC, for pre-fill.
  const props = await listAssociationProperties(data.assoc).catch(() => [])
  const addr  = props.find(p => String(p.PropertyHOID ?? '').toUpperCase() === data.account.toUpperCase())
    ?.Address?.find(a => a.OwnerAddress) ?? undefined
  const mailing = addr ? [addr.StreetNumber, addr.Address].filter(Boolean).join(' ').trim() || null : null

  const pdf = await renderAchAuthorizationPdf({
    ownerName: o?.name || 'Owner',
    unit:        o?.unitNumber ?? null,
    address:     o?.address ?? null,
    association: o?.associationName ?? data.assoc,
    account:     data.account,
    generatedOn: new Date().toISOString().slice(0, 10),
    email:          addr?.Email ?? null,
    phone:          addr?.MobilePhone || addr?.HomePhone || addr?.WorkPhone || null,
    mailingAddress: mailing,
    city:           addr?.City ?? null,
    state:          addr?.State ?? null,
    zip:            addr?.Zip ?? null,
  })

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="ACH-Authorization-${data.account}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
