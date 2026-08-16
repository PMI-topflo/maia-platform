// GET /api/admin/pre-apply/dashboard[?assoc=CODE]
//
// The staff applications dashboard: every open application across every
// association, reduced to whose turn it is. Staff-only.
//
// Staff are the only ones who see all associations at once, and the only ones
// who see the two stages that are theirs — an application nobody has been asked
// to review, and one whose documents are all approved but whose Board Decision
// has not been written.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getApplicationDashboard, STAGE_LABEL, STAGE_OWNER, STAGE_ORDER } from '@/lib/application-dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assoc = new URL(req.url).searchParams.get('assoc')
  const dash = await getApplicationDashboard({ associationCode: assoc })

  return NextResponse.json({
    role: 'staff',
    stageLabels: STAGE_LABEL, stageOwners: STAGE_OWNER, stageOrder: STAGE_ORDER,
    ...dash,
  })
}
