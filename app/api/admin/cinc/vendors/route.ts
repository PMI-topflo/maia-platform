// =====================================================================
// GET /api/admin/cinc/vendors?assocCode=ABBOT
//
// Returns the two-tier vendor list the vendor-picker modal needs:
//
//   {
//     forAssociation: [{ VendorId, VendorName }, ...],
//     allOthers:      [{ VendorId, VendorName }, ...],
//   }
//
// "forAssociation" comes from CINC's vendorAssociation endpoint (active
// vendors flagged as servicing the assoc) and surfaces in the top
// section of the picker. "allOthers" is the rest of the tenant's
// vendors, surfaced in the scrollable "All vendors" section below.
// Vendors that appear in both lists are filtered out of allOthers.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listVendors, listVendorsForAssociation } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url       = new URL(req.url)
  const assocCode = url.searchParams.get('assocCode')?.trim() ?? ''

  const [allRaw, forAssocRaw] = await Promise.all([
    listVendors().catch(() => []),
    assocCode ? listVendorsForAssociation(assocCode).catch(() => []) : Promise.resolve([]),
  ])

  // De-dupe + sort. forAssociation wins; allOthers excludes anything
  // already in forAssociation.
  const seen = new Set<number>()
  const forAssociation = forAssocRaw
    .filter(v => v.VendorId > 0 && v.VendorName)
    .map(v => ({ VendorId: v.VendorId, VendorName: v.VendorName }))
    .sort((a, b) => a.VendorName.localeCompare(b.VendorName))
  for (const v of forAssociation) seen.add(v.VendorId)

  const allOthers = allRaw
    .filter(v => v.VendorId > 0 && v.VendorName && !seen.has(v.VendorId))
    .map(v => ({ VendorId: v.VendorId, VendorName: v.VendorName }))
    .sort((a, b) => a.VendorName.localeCompare(b.VendorName))

  return NextResponse.json({ forAssociation, allOthers })
}
