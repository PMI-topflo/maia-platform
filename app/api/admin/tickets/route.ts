// =====================================================================
// app/api/admin/tickets/route.ts
// POST — manual ticket creation from the staff dashboard.
//
// Used by the "New Ticket" button on /admin/tickets when staff are
// logging an inquiry that didn't come in by email (phone call, walk-in,
// internal task, etc.). Optionally seeds the ticket with a first
// internal note so the timeline isn't empty.
// =====================================================================

import { NextResponse } from 'next/server'
import {
  createTicket,
  appendMessage,
  type TicketType,
  type TicketChannel,
  type TicketPriority,
} from '@/lib/tickets'
import { isValidTicketCategory } from '@/lib/ticket-categories'

export const dynamic = 'force-dynamic'

const VALID_TYPE:     TicketType[]     = ['ticket', 'work_order']
const VALID_CHANNEL:  TicketChannel[]  = ['email', 'whatsapp', 'sms', 'web', 'phone', 'internal']
const VALID_PRIORITY: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

interface CreateBody {
  type?:                 TicketType
  channel_origin?:       TicketChannel
  priority?:             TicketPriority
  association_code?:     string | null
  persona?:              string | null
  contact_name?:         string | null
  contact_email?:        string | null
  contact_phone?:        string | null
  subject?:              string | null
  summary?:              string | null
  assignee_email?:       string | null
  work_order_type_id?:   number | null
  work_order_type_name?: string | null
  ticket_category?:      string | null
  initial_note?:         string                // optional — seeds the timeline
  actor_email?:          string                // who is creating it
}

export async function POST(req: Request) {
  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.subject?.trim()) {
    return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  }
  if (body.type     && !VALID_TYPE    .includes(body.type))     return NextResponse.json({ error: 'Invalid type'     }, { status: 400 })
  if (body.priority && !VALID_PRIORITY.includes(body.priority)) return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  if (body.channel_origin && !VALID_CHANNEL.includes(body.channel_origin)) {
    return NextResponse.json({ error: 'Invalid channel_origin' }, { status: 400 })
  }
  if (body.ticket_category !== undefined
      && body.ticket_category !== null
      && !isValidTicketCategory(body.ticket_category)) {
    return NextResponse.json({ error: 'Invalid ticket_category' }, { status: 400 })
  }

  try {
    const ticket = await createTicket({
      type:                 body.type           ?? 'ticket',
      channel_origin:       body.channel_origin ?? 'internal',
      priority:             body.priority       ?? 'normal',
      association_code:     body.association_code,
      persona:              body.persona,
      contact_name:         body.contact_name,
      contact_email:        body.contact_email,
      contact_phone:        body.contact_phone,
      subject:              body.subject,
      summary:              body.summary ?? body.initial_note?.slice(0, 280) ?? null,
      assignee_email:       body.assignee_email,
      work_order_type_id:   body.work_order_type_id,
      work_order_type_name: body.work_order_type_name,
      ticket_category:      body.ticket_category,
    })

    if (body.initial_note?.trim()) {
      await appendMessage(ticket.id, {
        direction: 'internal_note',
        channel:   'internal',
        from_addr: body.actor_email ?? 'staff',
        body:      body.initial_note,
      })
    }

    return NextResponse.json({ ticket })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
