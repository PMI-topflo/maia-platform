// =====================================================================
// app/api/admin/cinc/work-orders/route.ts
// GET /api/admin/cinc/work-orders?assoc=KANE&vendor=123
// Returns open CINC work orders for the (assoc, vendor) pair so the
// invoice intake form can offer a "Link to work order" dropdown.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listOpenWorkOrders } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url      = new URL(req.url)
  const assoc    = (url.searchParams.get('assoc')  ?? '').trim()
  const vendorRaw = url.searchParams.get('vendor') ?? ''
  const vendorId = vendorRaw ? parseInt(vendorRaw, 10) : undefined

  if (!assoc) return NextResponse.json({ error: 'assoc query param required' }, { status: 400 })

  try {
    const wos = await listOpenWorkOrders({
      assocCode: assoc,
      // vendor is a PREFERENCE (sort first), not a hard filter — CINC WOs often
      // have no/lagging vendor, which hid the right WO. Show all assoc WOs.
      vendorPreferred: vendorId && Number.isFinite(vendorId) ? vendorId : undefined,
      includeCompleted: true,   // invoices arrive after the WO is done
    })
    // Slim shape for the dropdown.
    const workOrders = wos.map(w => ({
      number:      w.WorkOrderId,
      description: w.Description ?? '',
      vendor:      w.Vendor ?? null,
      vendorId:    w.VendorId ?? null,
      createdDate: w.CreatedDate ?? null,
      status:      w.WorkOrderStatus ?? null,
    }))
    return NextResponse.json({ assoc: assoc.toUpperCase(), vendorId: vendorId ?? null, workOrders })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC work-order fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
