// =====================================================================
// app/api/admin/vendors/cache/refresh/route.ts
// POST — force a refresh of the in-memory CINC vendor cache. Useful
// when Karen has just added a vendor in CINC and wants MAIA to see it
// immediately without waiting out the 1-hour TTL. Also returns the
// new vendor count so the UI can confirm.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { invalidateVendorCache, listVendorsFull } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function POST() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  invalidateVendorCache()
  const vendors = await listVendorsFull({ forceRefresh: true })
  return NextResponse.json({ ok: true, vendorCount: vendors.length })
}
