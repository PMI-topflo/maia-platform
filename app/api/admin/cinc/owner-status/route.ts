// =====================================================================
// GET /api/admin/cinc/owner-status?assoc=ABBOTT&account=AB02
//
// Staff-only PROBE to find the "Block Payments" / in-collections flag for a
// homeowner, so the ledger flow can refuse units in collections and redirect
// them to the collection agency. Returns the collections + legal-status rows
// that match the account (and their field names), plus the raw lists for
// inspection. Read-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listHomeownersInCollections, listLegalStatusByAssociation } from '@/lib/integrations/cinc'

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

  const [collections, legal] = await Promise.all([
    listHomeownersInCollections(assoc).catch(() => []),
    listLegalStatusByAssociation(assoc).catch(() => []),
  ])

  // Heuristic match: any row whose values mention the account (PropertyHoid).
  const matches = (rows: Record<string, unknown>[]) =>
    account ? rows.filter(r => Object.values(r).some(v => String(v).toUpperCase() === account)) : rows.slice(0, 3)

  return NextResponse.json({
    ok: true,
    assoc, account,
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
  })
}
