// =====================================================================
// GET /api/admin/cinc/owner-status?assoc=ABBOTT&account=AB02
//
// Staff-only diagnostic: shows both collections/block signals CINC exposes
// for a homeowner, and the combined "blocked" verdict the ledger/payment
// flows actually use (lib/owner-ledger-flow.ts isAccountInCollections —
// blocked if EITHER signal fires):
//   1. The formal collections workflow list (flaggedCollections/
//      homeownersInCollections) — reflects the "Collection Status" /
//      "Hold Collections" dropdowns on the Homeowner record.
//   2. The per-homeowner "Block Payments" toggle
//      (getHomeownerDetailsForIVRPayment — BlockPaymentsFlag /
//      IsHomeownerOrAssociationBlocked). CONFIRMED against prod 2026-07-03
//      via a live self-block test — a unit with ONLY "Block Payments" on
//      (Collection Status/Hold Collections left unset) is NOT caught by
//      signal 1 alone.
// Read-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listHomeownersInCollections, listLegalStatusByAssociation, getHomeownerPaymentBlockStatus } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url     = new URL(req.url)
  const assoc   = (url.searchParams.get('assoc') ?? '').trim()
  const account = (url.searchParams.get('account') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  const [collections, legal, blockStatus] = await Promise.all([
    listHomeownersInCollections(assoc).catch(() => []),
    listLegalStatusByAssociation(assoc).catch(() => []),
    account ? getHomeownerPaymentBlockStatus(account).catch(() => null) : Promise.resolve(null),
  ])

  // Heuristic match: any row whose values mention the account (PropertyHoid).
  const matches = (rows: Record<string, unknown>[]) =>
    account ? rows.filter(r => Object.values(r).some(v => String(v).toUpperCase() === account)) : rows.slice(0, 3)

  const inCollectionsList = account ? matches(collections).length > 0 : null
  const blockPaymentsFlag = blockStatus?.blocked ?? null

  return NextResponse.json({
    ok: true,
    assoc, account,
    verdict: account ? { blocked: !!(inCollectionsList || blockPaymentsFlag), inCollectionsList, blockPaymentsFlag } : null,
    collections: {
      count:        collections.length,
      sampleKeys:   collections[0] ? Object.keys(collections[0]) : [],
      matchedRows:  matches(collections),
    },
    legalStatus: {
      count:        legal.length,
      sampleKeys:   legal[0] ? Object.keys(legal[0]) : [],
      matchedRows:  matches(legal),
    },
    blockPaymentsStatus: blockStatus,
  })
}
