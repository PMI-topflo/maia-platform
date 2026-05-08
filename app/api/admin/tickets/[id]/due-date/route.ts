// =====================================================================
// app/api/admin/tickets/[id]/due-date/route.ts
// POST — push a ticket's due date with a recorded reason.
//
// Body: { new_due_at: ISO, reason_code: string, note?: string,
//         actor_email?: string }
// The reason_code must be in lib/ticket-delay-reasons. The handler
// resolves it to the canonical label + bucket and writes a
// 'due_changed' ticket_events row alongside the date update.
// =====================================================================

import { NextResponse } from 'next/server'
import { changeDueDate } from '@/lib/tickets'
import { getDelayReason } from '@/lib/ticket-delay-reasons'

export const dynamic = 'force-dynamic'

interface PostBody {
  new_due_at:  string
  reason_code: string
  note?:       string
  actor_email?: string
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  let body: PostBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.new_due_at || !body.reason_code) {
    return NextResponse.json({ error: 'new_due_at and reason_code required' }, { status: 400 })
  }

  // Validate ISO date
  const parsed = new Date(body.new_due_at)
  if (Number.isNaN(parsed.getTime())) {
    return NextResponse.json({ error: 'Invalid new_due_at' }, { status: 400 })
  }

  const reason = getDelayReason(body.reason_code)
  if (!reason) {
    return NextResponse.json({ error: 'Unknown reason_code' }, { status: 400 })
  }

  try {
    const ticket = await changeDueDate(
      ticketId,
      parsed.toISOString(),
      reason.code,
      reason.label,
      reason.bucket,
      body.actor_email ?? 'staff',
      body.note,
    )
    return NextResponse.json({ ticket })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
