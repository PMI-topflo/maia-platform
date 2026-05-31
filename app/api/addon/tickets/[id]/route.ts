// =====================================================================
// PATCH /api/addon/tickets/[id]
//
// The add-on's status/assign/priority/due controls. Thin wrapper over
// updateTicket() so the change emits the same ticket_events audit rows as
// the /admin queue — one source of truth, attributed to the staffer.
//
// Body: { status?, priority?, assignee_email?, due_at?, subject?, summary? }
// Auth: add-on bearer token.
// =====================================================================

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { updateTicket, type UpdateTicketPatch, type TicketStatus, type TicketPriority } from '@/lib/tickets'

export const dynamic = 'force-dynamic'

const STATUSES: TicketStatus[]     = ['open', 'pending', 'waiting_external', 'resolved', 'closed']
const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* allow empty */ }

  const patch: UpdateTicketPatch = {}
  if ('status' in body) {
    if (!STATUSES.includes(body.status as TicketStatus)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    patch.status = body.status as TicketStatus
  }
  if ('priority' in body) {
    if (!PRIORITIES.includes(body.priority as TicketPriority)) return NextResponse.json({ error: 'invalid priority' }, { status: 400 })
    patch.priority = body.priority as TicketPriority
  }
  if ('assignee_email' in body) patch.assignee_email = (body.assignee_email as string | null) ?? null
  if ('due_at' in body)         patch.due_at         = (body.due_at as string | null) ?? null
  if ('subject' in body)        patch.subject        = (body.subject as string | null) ?? null
  if ('summary' in body)        patch.summary        = (body.summary as string | null) ?? null

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'no changes' }, { status: 400 })

  try {
    const ticket = await updateTicket(id, patch, staff)
    return NextResponse.json({ ticket })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
