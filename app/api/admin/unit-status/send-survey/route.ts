// =====================================================================
// POST /api/admin/unit-status/send-survey   (staff-only)
// body: { assoc?: string, confirm?: boolean }
// Staff-triggered occupancy/insurance survey campaign — a dry run (default)
// returns the count + sample of who WOULD be emailed; pass confirm:true to
// actually send. Reuses runOwnerComplianceAudit's surveyMode (sends to every
// active owner, not just those with missing docs) and its existing
// owner_compliance_requests cadence/cap so this can't spam someone the
// automated audit already reached this cycle.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { runOwnerComplianceAudit } from '@/lib/compliance-owner-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { assoc?: string; confirm?: boolean }
  try { body = await req.json() } catch { body = {} }

  const result = await runOwnerComplianceAudit({
    assoc: body.assoc || null,
    surveyMode: true,
    dryRun: !body.confirm,
    limit: 500,
  })
  return NextResponse.json({ ok: true, dryRun: !body.confirm, ...result })
}
