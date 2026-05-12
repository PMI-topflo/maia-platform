// =====================================================================
// app/api/admin/tickets/[id]/route.ts
// PATCH a ticket — status, priority, assignee, due_at, type, summary.
// Each meaningful change emits a ticket_events row via lib/tickets.
// =====================================================================

import { NextResponse } from 'next/server'
import { updateTicket, type TicketStatus, type TicketPriority, type TicketType } from '@/lib/tickets'

export const dynamic = 'force-dynamic'

const VALID_STATUS:   TicketStatus[]   = ['open', 'pending', 'waiting_external', 'resolved', 'closed']
const VALID_PRIORITY: TicketPriority[] = ['low', 'normal', 'high', 'urgent']
const VALID_TYPE:     TicketType[]     = ['ticket', 'work_order']

interface PatchBody {
  status?:               TicketStatus
  priority?:             TicketPriority
  type?:                 TicketType
  assignee_email?:       string | null
  due_at?:               string | null
  subject?:              string | null
  summary?:              string | null
  work_order_type_id?:   number | null
  work_order_type_name?: string | null
  actor_email?:          string
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.status   && !VALID_STATUS  .includes(body.status))   return NextResponse.json({ error: 'Invalid status'   }, { status: 400 })
  if (body.priority && !VALID_PRIORITY.includes(body.priority)) return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  if (body.type     && !VALID_TYPE    .includes(body.type))     return NextResponse.json({ error: 'Invalid type'     }, { status: 400 })
  if (body.work_order_type_id !== undefined
      && body.work_order_type_id !== null
      && !(Number.isInteger(body.work_order_type_id) && body.work_order_type_id > 0)) {
    return NextResponse.json({ error: 'Invalid work_order_type_id' }, { status: 400 })
  }

  try {
    const ticket = await updateTicket(
      ticketId,
      {
        status:               body.status,
        priority:             body.priority,
        type:                 body.type,
        assignee_email:       body.assignee_email,
        due_at:               body.due_at,
        subject:              body.subject,
        summary:              body.summary,
        work_order_type_id:   body.work_order_type_id,
        work_order_type_name: body.work_order_type_name,
      },
      body.actor_email ?? 'staff',
    )
    return NextResponse.json({ ticket })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
