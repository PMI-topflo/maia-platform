// POST /api/admin/pre-apply/[id]/interview   { action: 'complete' }
// Staff mark the board/buyer interview as held (association requires it —
// see lib/board-decision-letter.ts's advanceToApprovalSent) and re-trigger
// the normal advance so the real approval letter goes out. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { loadDecisionContext, markInterviewCompleteAndAdvance } from '@/lib/board-decision-letter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadDecisionContext(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    required: c.interviewRequired, requestedAt: c.interviewRequestedAt, completedAt: c.interviewCompletedAt,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let b: { action?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (b.action !== 'complete') return NextResponse.json({ error: 'action must be complete' }, { status: 400 })

  await markInterviewCompleteAndAdvance(id)
  const c = await loadDecisionContext(id)
  return NextResponse.json({ ok: true, completedAt: c?.interviewCompletedAt ?? null })
}
