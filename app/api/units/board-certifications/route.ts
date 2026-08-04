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
  // Standing + enough to drive per-document upload boxes (member id + which doc
  // types are on file). Managers/board with upload permission can add certs;
  // everyone can read. No doc ids / previews (those stay on the admin hub).
  return NextResponse.json({
    kind: overview.kind,
    canUpload: auth.canUpload,
    expiredCount: overview.expiredCount,
    expiringCount: overview.expiringCount,
    missingCount: overview.missingCount,
    members: overview.members.map(m => ({
      id: m.id, name: m.name, role: m.role, state: m.summary.state,
      initialCertExpiration: m.summary.initialCertExpiration,
      continuingEdDue: m.summary.continuingEdDue,
      continuingEdOverdue: m.summary.continuingEdOverdue,
      docs: m.docs.map(d => ({ doc_type: d.doc_type, status: d.status, certificate_date: d.certificate_date })),
    })),
  })
}
