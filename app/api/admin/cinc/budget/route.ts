// =====================================================================
// app/api/admin/cinc/budget/route.ts
// GET /api/admin/cinc/budget?assoc=KANE — returns the GL options for
// the invoice intake dropdown, fetched from CINC's
// /accounting/budget/association/{assocCode}. Cached server-side for
// 30 min (see lib/integrations/cinc.ts getAssociationBudget).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getAssociationBudget } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url   = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim()
  const force = url.searchParams.get('refresh') === '1'
  if (!assoc) return NextResponse.json({ error: 'assoc query param required' }, { status: 400 })

  try {
    const lines = await getAssociationBudget(assoc, { forceRefresh: force })
    return NextResponse.json({ assoc: assoc.toUpperCase(), lines })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC budget fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
