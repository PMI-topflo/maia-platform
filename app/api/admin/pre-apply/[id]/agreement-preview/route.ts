// GET /api/admin/pre-apply/[id]/agreement-preview
// The Landlord–Tenant Agreement as it stands RIGHT NOW, rendered inline as a
// PDF. Staff-only.
//
// Why this exists: this is the one checklist item with no file behind it until
// BOTH parties have signed — the PDF is only generated and filed at the second
// signature. Until then the row says "1/2 signed, waiting on Tenant" and shows
// nothing else, so nobody can see what the document actually says.
//
// MANXI 702, 2026-09-09: the packet was created naming the applicant's REALTOR
// as the Tenant, with a lease term inherited from a tenancy that ended in 2024.
// The owner signed it. Nobody could see any of that for six days, until the
// agent herself emailed in asking to be removed as a tenant. The content was
// wrong from the moment it was created and the UI had no way to show it.
//
// Renders from the live lease_packets row through the same
// agreementPropsFromPacket() the filed copy uses, so what staff see here is
// byte-for-byte what the next signer sees — including any signature already
// captured. Read-only: nothing is written, sent or filed.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { findUnitLeasePacket, getLeasePacket, agreementPropsFromPacket } from '@/lib/lease-packet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const unit = (app.unit_label as string | null) ?? null
  if (!unit) return NextResponse.json({ error: 'This application has no unit on file.' }, { status: 400 })

  const found = await findUnitLeasePacket(String(app.association_code), unit)
  if (!found) return NextResponse.json({ error: 'The Landlord–Tenant Agreement has not been sent for this unit yet — there is nothing to preview.' }, { status: 404 })
  const packet = await getLeasePacket(found.id)
  if (!packet) return NextResponse.json({ error: 'Lease packet not found.' }, { status: 404 })

  try {
    const { renderToBuffer } = await import('@react-pdf/renderer')
    const { LeasePacketAgreementPdf } = await import('@/lib/lease-packet-pdf')
    const pdf = Buffer.from(await renderToBuffer(LeasePacketAgreementPdf(agreementPropsFromPacket(packet))) as unknown as Uint8Array)
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="Landlord-Tenant-Agreement-Unit-${unit}-preview.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: `Could not render the agreement: ${(e as Error).message}` }, { status: 500 })
  }
}
