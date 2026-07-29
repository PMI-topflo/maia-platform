// GET /api/units/board-certifications?assoc=CODE
// Board-education standing for the association, for the /units audit portal
// (board members + on-site/unit managers + staff). Read-only summary — the
// full manage UI lives on the admin Association Hub.

import { NextResponse } from 'next/server'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { getBoardCertOverview } from '@/lib/board-certification-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await resolveUnitsAuth(new URL(req.url).searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const overview = await getBoardCertOverview(auth.assoc)
  // Trim to a read-only shape (names + standing only; no doc ids / previews).
  return NextResponse.json({
    kind: overview.kind,
    expiredCount: overview.expiredCount,
    expiringCount: overview.expiringCount,
    missingCount: overview.missingCount,
    members: overview.members.map(m => ({
      name: m.name, role: m.role, state: m.summary.state,
      initialCertExpiration: m.summary.initialCertExpiration,
      continuingEdDue: m.summary.continuingEdDue,
    })),
  })
}
