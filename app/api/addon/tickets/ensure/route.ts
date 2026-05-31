// =====================================================================
// POST /api/addon/tickets/ensure
//
// The add-on's guided "create ticket / work order from this email"
// button. Idempotent: if an open ticket already matches the thread or
// contact it's returned (not duplicated); otherwise a new one is created.
// Optionally records the staffer's instructions as an internal note.
//
// Body:
//   { type?, priority?, association_code?, persona?, contact_name?,
//     contact_email?, gmail_thread_id?, subject?, summary?,
//     is_board_request?, assignToMe?, note? }
//
// Auth: add-on bearer token. The created/updated ticket is attributed to
// the calling staffer, and assigned to them when assignToMe (default).
// =====================================================================

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import {
  findOpenTicketByGmailThread,
  findOpenTicketByContact,
  createTicket,
  appendMessage,
  type TicketType,
  type TicketPriority,
} from '@/lib/tickets'

export const dynamic = 'force-dynamic'

const TYPES: TicketType[]          = ['ticket', 'work_order']
const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

interface Body {
  type?:             string
  priority?:         string
  association_code?: string | null
  persona?:          string | null
  contact_name?:     string | null
  contact_email?:    string | null
  gmail_thread_id?:  string | null
  subject?:          string | null
  summary?:          string | null
  is_board_request?: boolean
  assignToMe?:       boolean
  note?:             string | null
}

export async function POST(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: Body = {}
  try { body = await req.json() } catch { /* allow empty */ }

  const type     = TYPES.includes(body.type as TicketType) ? (body.type as TicketType) : 'ticket'
  const priority = PRIORITIES.includes(body.priority as TicketPriority) ? (body.priority as TicketPriority) : 'normal'
  const email    = (body.contact_email ?? '').trim().toLowerCase() || null
  const thread   = (body.gmail_thread_id ?? '').trim() || null

  // Idempotency: reuse an existing open ticket on this thread/contact.
  let existing = null
  if (thread) existing = await findOpenTicketByGmailThread(thread)
  if (!existing && email) existing = await findOpenTicketByContact({ email, associationCode: body.association_code ?? null })

  const ticket = existing ?? await createTicket({
    type,
    channel_origin:   'email',
    priority,
    association_code: body.association_code ?? null,
    persona:          body.persona ?? null,
    contact_name:     body.contact_name ?? null,
    contact_email:    email,
    gmail_thread_id:  thread,
    subject:          body.subject ?? null,
    summary:          body.summary ?? null,
    is_board_request: body.is_board_request ?? false,
    assignee_email:   body.assignToMe === false ? null : staff,
  })

  // Record the staffer's instructions as an internal note, when provided.
  if (body.note && body.note.trim()) {
    await appendMessage(ticket.id, {
      direction: 'internal_note',
      channel:   'internal',
      from_addr: staff,
      body:      body.note.trim(),
    }).catch(() => null)
  }

  return NextResponse.json({ ticket, created: !existing })
}
