// =====================================================================
// app/api/admin/cinc/work-order-types/route.ts
// GET — returns the CINC work-order type catalog for the NewTicketModal
// dropdown. Module-level cache in lib/integrations/cinc.ts means most
// calls don't actually hit CINC.
// =====================================================================

import { NextResponse } from 'next/server'
import { listWorkOrderTypes } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const types = await listWorkOrderTypes()
    const items = types.map(t => ({
      id:   t.WorkOrderTypeId,
      name: t.WorkOrderTypeDescription,
    }))
    return NextResponse.json({ items })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg, items: [] }, { status: 500 })
  }
}
