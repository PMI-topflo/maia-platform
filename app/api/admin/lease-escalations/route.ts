// GET  /api/admin/lease-escalations?resolved=1  → units in the lease non-renewal escalation (staff)
// POST /api/admin/lease-escalations  { action, id, ... }
//   fee      { id, authorized, amount }  the violation-fee decision
//              authorized true  → pre-authorize the fee (amount required)
//              authorized false → decided: no fee
//              authorized null  → back to undecided
//   escalate { id }  start the escalation by hand on a backlog unit — one the
//              cron will not touch itself (lease ended more than
//              ESCALATION.backlogDays ago), so the notice is a staff decision
// The fee is recorded here and AR is emailed to post it in CINC; MAIA cannot
// post a charge itself (lib/integrations/cinc.ts reads ledgers only).

import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { buildEscalations, decideViolationFee, escalateById } from '@/lib/lease-escalation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const includeResolved = new URL(req.url).searchParams.get('resolved') === '1'
  try {
    return NextResponse.json(await buildEscalations({ includeResolved }))
  } catch (e) {
    // Surfaced rather than swallowed: the likeliest cause is the migration
    // not being applied yet, and an empty list would read as "nothing to do".
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
}

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const id = String(b.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (b.action === 'escalate') {
    const r = await escalateById(id)
    return 'error' in r ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r)
  }

  const authorized = b.authorized === null ? null : b.authorized === true ? true : b.authorized === false ? false : undefined
  if (authorized === undefined) return NextResponse.json({ error: 'authorized must be true, false or null' }, { status: 400 })

  let amount: number | null = null
  if (authorized === true) {
    amount = Number(b.amount)
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Enter the fee amount the Board is authorizing.' }, { status: 400 })
  }

  const r = await decideViolationFee(id, { authorized, amount, by: staffLabel(session) })
  return 'error' in r ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r)
}
