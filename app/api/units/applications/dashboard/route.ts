// GET /api/units/applications/dashboard[?assoc=CODE]
//
// The same dashboard as staff see, scoped to one association, for the two
// people who actually decide: a board member and the on-site manager.
//
// They get the identical numbers — getApplicationDashboard is the only thing
// that computes them — but their own stage is called out, and each row that is
// waiting on them carries the review link it was sent on, so they can go
// straight from "3 to decide" to deciding.
//
// A unit_manager is an OWNER's per-unit manager, not association staff, and is
// refused here: an association-wide list of applicants is not theirs to read.

import { NextResponse } from 'next/server'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { getApplicationDashboard, STAGE_LABEL, STAGE_OWNER, STAGE_ORDER } from '@/lib/application-dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await resolveUnitsAuth(new URL(req.url).searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (auth.persona === 'unit_manager') {
    return NextResponse.json({ error: 'Applications are reviewed by the board and the on-site manager.' }, { status: 403 })
  }

  // Submitted only: the list below this dashboard is the submitted queue, so a
  // row must have something a reviewer can actually open.
  const dash = await getApplicationDashboard({ associationCode: auth.assoc, submittedOnly: true })

  return NextResponse.json({
    role: auth.persona === 'board' ? 'board' : auth.persona === 'building_manager' ? 'onsite_manager' : 'staff',
    viewerName: auth.name,
    associationCode: auth.assoc,
    stageLabels: STAGE_LABEL, stageOwners: STAGE_OWNER, stageOrder: STAGE_ORDER,
    ...dash,
  })
}
