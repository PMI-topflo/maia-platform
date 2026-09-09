// =====================================================================
// GET /api/admin/cinc/homeowner-status-debug?assoc=VPREC
//
// Staff-only, read-only raw dump of CINC's associationWithProperty
// response (the same endpoint lib/cinc-sync.ts's buildSyncPreview uses),
// UNTYPED — so we can see what CINC actually returns at runtime instead
// of guessing from Swagger's generic example schema, which can overstate
// what a specific call populates. Built 2026-09-09 specifically to
// confirm whether `HomeownerStatus` (shown on the swagger doc alongside
// AccountNumber/BillingType) is a real, populated field here, ahead of
// wiring a "skip non-billable/developer accounts" filter into the sync.
//
// No terminal/probe-script access needed — just visit this URL while
// logged into /admin. Debug-only; nothing reads from this route.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { debugAssociationWithPropertyRaw } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url   = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim()
  if (!assoc) return NextResponse.json({ error: 'assoc query param is required, e.g. ?assoc=VPREC' }, { status: 400 })

  try {
    const raw = await debugAssociationWithPropertyRaw(assoc)
    const arr = Array.isArray(raw) ? raw as Record<string, unknown>[] : []
    return NextResponse.json({
      ok: true,
      assoc,
      // Quick eyeball: does the wrapper carry a real per-account status?
      topLevelKeys: arr[0] ? Object.keys(arr[0]) : [],
      accountSummaries: arr.map(a => ({
        AccountNumber: a.AccountNumber ?? null,
        HomeownerStatus: a.HomeownerStatus ?? null,
        BillingType: a.BillingType ?? null,
        propertyCount: Array.isArray(a.PropertyInfo) ? a.PropertyInfo.length : 0,
      })),
      raw,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
