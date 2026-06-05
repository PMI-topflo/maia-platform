// =====================================================================
// GET /api/admin/vendors/[vendorId]/compliance?assoc=ABBOTT
//
// What's already on file for a CINC vendor — ACH banking, W-9, COI (with
// expiry/validity, optionally scoped to an association), and license.
// Powers the On-Hold modal pre-check (don't ask for docs we already have
// and that are still valid) and Paola's vendor-compliance audit.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getVendorComplianceStatus } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ vendorId: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { vendorId: vidStr } = await ctx.params
  const vendorId = Number(vidStr)
  if (!Number.isFinite(vendorId) || vendorId <= 0) {
    return NextResponse.json({ error: 'invalid vendorId' }, { status: 400 })
  }
  const assoc = new URL(req.url).searchParams.get('assoc')

  try {
    const status = await getVendorComplianceStatus(vendorId, assoc)
    return NextResponse.json(status)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
