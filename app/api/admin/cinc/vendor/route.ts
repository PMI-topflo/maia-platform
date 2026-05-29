// =====================================================================
// app/api/admin/cinc/vendor/route.ts
//
// GET /api/admin/cinc/vendor?vendorId=12345
//
// Returns the CINC vendor's profile, including the DERIVED
// "DefaultPmtMethod" — ACH if the vendor has Routing+Account
// configured in CINC, otherwise Check. Mirrors what CINC's vendor
// page shows in its "Default Pmt Method" field.
//
// Backs the read-only "CINC default Pmt Method" hint on the invoice
// intake card so Karen can verify her Pay By selection matches the
// CINC vendor profile BEFORE pushing. We do NOT let Karen edit this
// — payment-method changes require bank/ACH setup outside MAIA.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getCincVendorDetail } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url   = new URL(req.url)
  const idStr = (url.searchParams.get('vendorId') ?? '').trim()
  const id    = parseInt(idStr, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'vendorId query param required (positive integer)' }, { status: 400 })
  }

  try {
    const vendor = await getCincVendorDetail(id)
    if (!vendor) return NextResponse.json({ error: 'Vendor not found in CINC' }, { status: 404 })
    return NextResponse.json({ vendor })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC vendor fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
