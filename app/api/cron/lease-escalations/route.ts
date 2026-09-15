// GET /api/cron/lease-escalations
// Phase 5 of the Checkr-first redesign: the lease non-renewal escalation.
// Daily. For every lease that has ended and whose OWNER still has not
// answered the check-in, this walks the three steps in lib/lease-escalation.ts:
//   T      escalation notice to the owner, 15-day clock starts
//   T+15   the 15 days are up → staff / board / on-site manager get the
//          violation-fee decision (or, when pre-authorized, AR is told to
//          post it in CINC)
//   T+45   still no document and no active renewal → the application expires
//          and the row goes red on Leasing → Lease escalations
// The clocks stop the moment the owner answers anything at all.
// Two callers, same shape as the other lease crons:
//   • Vercel cron (Bearer CRON_SECRET) — sends.
//   • Staff (session) — dry-run by default; ?send=1 to actually send.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { runLeaseEscalations } from '@/lib/lease-escalation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const cron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  const staff = cron ? null : await requireStaffSession()
  if (!cron && !staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dryRun = !(cron || new URL(req.url).searchParams.get('send') === '1')

  try {
    const actions = await runLeaseEscalations({ dryRun })
    return NextResponse.json({ ok: true, dryRun, count: actions.length, actions })
  } catch (e) {
    console.error('[cron/lease-escalations]', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 })
  }
}
