// =====================================================================
// GET /api/admin/cinc/homeowner-status-debug?assoc=VPREC[&hoId=VP1M2304#27]
//
// Staff-only, read-only raw CINC dumps, UNTYPED — so we can see what CINC
// actually returns at runtime instead of guessing from Swagger's generic
// example schema, which can overstate what a specific call populates.
// Built 2026-09-09 to find the "Status" field (Owner / Previous Owner /
// Developer-NonBillable — shown on CINC's Homeowner Information page)
// somewhere in the API, ahead of wiring a "skip non-billable/developer
// accounts" filter into the sync.
//
// CONFIRMED (VPREC): associationWithProperty's HomeownerStatus/
// AccountNumber/BillingType wrapper fields are always null — that bulk
// per-association endpoint does not expose Status at all. Per
// CINC_API.md's own prior note (2026-08-23), Status almost certainly
// backs isCurrentOwner (a derived boolean, not the raw string) instead.
// getHomeownerDetailsForIVRPayment is a genuine PER-ACCOUNT lookup
// (hoId=account_number) our code already calls for a different purpose
// (lib/integrations/cinc.ts's getHomeownerPaymentBlockStatus) but only
// reads 3 fields from -- pass &hoId= to dump everything else it returns,
// in case Status rides along there instead.
//
// No terminal/probe-script access needed — just visit this URL while
// logged into /admin. Debug-only; nothing reads from this route.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { debugAssociationWithPropertyRaw, debugHomeownerDetailsForIVRPaymentRaw } from '@/lib/integrations/cinc'

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
  const hoId  = (url.searchParams.get('hoId') ?? '').trim()
  if (!assoc) return NextResponse.json({ error: 'assoc query param is required, e.g. ?assoc=VPREC' }, { status: 400 })

  try {
    const raw = await debugAssociationWithPropertyRaw(assoc)
    const arr = Array.isArray(raw) ? raw as Record<string, unknown>[] : []

    const ivr = hoId ? await debugHomeownerDetailsForIVRPaymentRaw(hoId) : null
    const ivrArr = Array.isArray(ivr) ? ivr as Record<string, unknown>[] : []

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
      ...(hoId ? {
        hoId,
        ivrTopLevelKeys: ivrArr[0] ? Object.keys(ivrArr[0]) : [],
        ivrRaw: ivr,
      } : {}),
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
