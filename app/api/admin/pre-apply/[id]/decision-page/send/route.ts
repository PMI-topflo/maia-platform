// POST /api/admin/pre-apply/[id]/decision-page/send   { docId }
// Email each unsigned board signer their signing link for the Board Decision
// Page / approval letter (after PMI's review). Staff-only.
//
// Thin wrapper around lib/board-decision-letter.ts's sendSignerInvitations —
// the same function the automatic under_review → approval_sent transition
// calls, so a staff-triggered send and an automatic one behave identically
// (including the office CC).

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { sendSignerInvitations } from '@/lib/board-decision-letter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ctx.params
  let b: { docId?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docId = String(b.docId ?? '').trim()
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 })

  const { sent, to, note } = await sendSignerInvitations(docId)
  return NextResponse.json({ ok: true, sent, to, ...(note ? { note } : {}) })
}
