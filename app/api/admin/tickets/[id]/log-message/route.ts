// =====================================================================
// app/api/admin/tickets/[id]/log-message/route.ts
//
// Manually log a message that happened OUTSIDE the platform (e.g. an
// SMS received on a staffer's Dialpad line, a phone call, a WhatsApp
// thread on a personal device). Records into ticket_messages without
// sending anything via Twilio/Resend.
//
// Distinguished from sent-by-us messages via external_id = 'logged-…'
// so the timeline can render a "📋 Logged" badge.
// =====================================================================
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

type Direction = 'inbound' | 'outbound'
type Channel   = 'sms' | 'whatsapp' | 'call' | 'email'

interface PostBody {
  direction:    Direction
  channel:      Channel
  body:         string
  from_addr?:   string
  to_addr?:     string
  happened_at?: string   // ISO; defaults to NOW()
  note?:        string   // optional context like "from Dialpad"
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
  if (!body.body?.trim()) {
    return NextResponse.json({ error: 'Message body required' }, { status: 400 })
  }
  if (body.direction !== 'inbound' && body.direction !== 'outbound') {
    return NextResponse.json({ error: 'direction must be inbound or outbound' }, { status: 400 })
  }
  if (!['sms', 'whatsapp', 'call', 'email'].includes(body.channel)) {
    return NextResponse.json({ error: 'unsupported channel' }, { status: 400 })
  }

  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, contact_phone, contact_email')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  // Default from/to based on direction + channel + ticket contact info.
  // Staff can override via the modal but most of the time these defaults
  // are right.
  const customerAddr = body.channel === 'email' ? ticket.contact_email : ticket.contact_phone
  const fromAddr = body.from_addr ?? (body.direction === 'inbound' ? customerAddr ?? 'unknown' : 'staff (logged)')
  const toAddr   = body.to_addr   ?? (body.direction === 'inbound' ? 'staff (logged)' : customerAddr ?? 'unknown')

  const happenedAt = body.happened_at ?? new Date().toISOString()
  const externalId = `logged-${randomUUID()}`

  const noteSuffix = body.note?.trim() ? `\n\n— Logged: ${body.note.trim()}` : ''

  const { data: message, error: insertErr } = await supabaseAdmin
    .from('ticket_messages')
    .insert({
      ticket_id:   ticketId,
      direction:   body.direction,
      channel:     body.channel,
      from_addr:   fromAddr,
      to_addr:     toAddr,
      body:        body.body + noteSuffix,
      external_id: externalId,
      created_at:  happenedAt,
    })
    .select('*')
    .single()

  if (insertErr || !message) {
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  await supabaseAdmin
    .from('tickets')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', ticketId)

  await supabaseAdmin.from('ticket_events').insert({
    ticket_id:   ticketId,
    event_type:  'message_logged',
    actor_email: 'staff',
    happened_at: happenedAt,
    payload: {
      channel:     body.channel,
      direction:   body.direction,
      external_id: externalId,
    },
  })

  return NextResponse.json({ message })
}
