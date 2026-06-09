// =====================================================================
// app/api/admin/invoices/seed-account-routes/route.ts
//
// POST — seed the utility account-number routing map from CINC's
// vendor/{id}/accounts (AccountNumber + AssocCode + GlAccount) for the
// utility vendors. One-time / occasional admin action. Never clobbers a
// route already learned from a confirmed invoice. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { seedAccountRoutesFromCinc } from '@/lib/account-routing'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await seedAccountRoutesFromCinc()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
