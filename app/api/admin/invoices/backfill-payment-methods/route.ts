// =====================================================================
// app/api/admin/invoices/backfill-payment-methods/route.ts
//
// POST — read every invoice for each active association over the last
// ~12 months from CINC (each row carries PayByType + VendorID) and learn
// the dominant payment method per vendor into vendor_payment_methods.
// One-time / occasional admin action. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { backfillVendorPaymentMethods } from '@/lib/account-routing'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await backfillVendorPaymentMethods({ months: 12 })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
