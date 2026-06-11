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
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', pending: 'Pending', waiting_external: 'Waiting on vendor', resolved: 'Resolved', closed: 'Closed',
}
const prettyStatus = (s: string | null) => (s ? STATUS_LABEL[s] ?? s : null)

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
      status:      prettyStatus(w.WorkOrderStatus ?? null),
    }))

    // Enrich with MAIA's truth: CINC lags staff edits (vendor reassignment,
    // resolving a WO), so a WO that exists as a MAIA ticket has a more current
    // status + vendor. Prefer MAIA's values so the picker matches what staff see.
    const numbers = workOrders.map(w => w.number).filter((n): n is number => Number.isFinite(n))
    if (numbers.length) {
      const { data: tix } = await supabaseAdmin.from('tickets')
        .select('id, cinc_workorder_id, status').in('cinc_workorder_id', numbers.map(String))
      const byWo = new Map((tix ?? []).map(t => [String(t.cinc_workorder_id), { id: t.id as number, status: t.status as string }]))
      const ticketIds = (tix ?? []).map(t => t.id as number)
      const vendorByTicket = new Map<number, string | null>()
      if (ticketIds.length) {
        const { data: wod } = await supabaseAdmin.from('work_order_details').select('ticket_id, vendor_name').in('ticket_id', ticketIds)
        for (const r of wod ?? []) vendorByTicket.set(r.ticket_id as number, (r.vendor_name as string | null) ?? null)
      }
      for (const w of workOrders) {
        const m = byWo.get(String(w.number))
        if (!m) continue
        w.status = prettyStatus(m.status)            // MAIA status wins (e.g. Resolved)
        const v = vendorByTicket.get(m.id)
        if (v) w.vendor = v                          // MAIA vendor wins when present
      }
    }
    return NextResponse.json({ assoc: assoc.toUpperCase(), vendorId: vendorId ?? null, workOrders })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC work-order fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
