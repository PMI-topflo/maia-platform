// =====================================================================
// app/api/admin/tickets/[id]/messages/route.ts
// POST a new message on a ticket. Two flavors:
//   - direction='internal_note', channel='internal' → just stored
//   - direction='outbound',      channel='email'    → sent via Gmail/
//     Resend (whatever lib/gmail picks) using In-Reply-To headers when
//     a gmail_thread_id is present, then stored.
//
// Outbound on other channels (sms/whatsapp) is not yet implemented.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { appendMessage, type MessageDirection, type TicketChannel } from '@/lib/tickets'
import { sendEmail } from '@/lib/gmail'
import { sendSMSStrict, sendWhatsAppStrict } from '@/lib/twilio-send'
import { logEmail } from '@/lib/email-logger'

export const dynamic = 'force-dynamic'

interface PostBody {
  direction:  MessageDirection
  channel:    TicketChannel
  body:       string
  body_html?: string
  subject?:   string
  to_addr?:   string
  from_addr?: string
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

  // Need the ticket for routing decisions (gmail thread id, contact addr).
  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from('tickets')
    .select('id, subject, contact_email, contact_phone, gmail_thread_id, channel_origin')
    .eq('id', ticketId)
    .single()
  if (ticketErr || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  // Internal notes — just record.
  if (body.direction === 'internal_note') {
    const message = await appendMessage(ticketId, {
      direction: 'internal_note',
      channel:   'internal',
      from_addr: body.from_addr ?? 'staff',
      body:      body.body,
    })
    return NextResponse.json({ message })
  }

  // Outbound email reply — send first, then record (with the Resend message id).
  if (body.direction === 'outbound' && body.channel === 'email') {
    const recipient = body.to_addr ?? ticket.contact_email
    if (!recipient) {
      return NextResponse.json({ error: 'No contact email on this ticket' }, { status: 400 })
    }
    const subject = body.subject ?? (ticket.subject?.startsWith('Re:') ? ticket.subject : `Re: ${ticket.subject ?? '(no subject)'}`)
    const html    = body.body_html ?? `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">${body.body
      .split('\n').map(line => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join('')}</body></html>`

    let externalId: string | null = null
    try {
      const result = await sendEmail({
        to:      recipient,
        subject,
        html,
        text:    body.body,
        // Use ticket_number as a stable thread token; Gmail/Resend use
        // In-Reply-To/References to keep replies stitched into the same
        // thread. If we have a gmail_thread_id we still rely on the
        // Subject + recipient match, which Gmail handles well.
        ...(ticket.gmail_thread_id && {
          headers: {
            'X-MAIA-Ticket-Id':     String(ticketId),
            'X-MAIA-Gmail-Thread':  ticket.gmail_thread_id,
          },
        }),
      })
      externalId = result.messageId ?? null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Email send failed: ${msg}` }, { status: 500 })
    }

    void logEmail({
      direction:       'outbound',
      toEmail:         recipient,
      subject,
      fullBody:        html,
      persona:         'staff',
      status:          'sent',
      resendMessageId: externalId ?? undefined,
      sentBy:          'staff-dashboard',
    })

    const message = await appendMessage(ticketId, {
      direction:   'outbound',
      channel:     'email',
      from_addr:   'maia@pmitop.com',
      to_addr:     recipient,
      subject,
      body:        body.body,
      body_html:   html,
      external_id: externalId,
    })
    return NextResponse.json({ message })
  }

  // Outbound SMS / WhatsApp — send via Twilio, then record with the sid.
  if (body.direction === 'outbound' && (body.channel === 'sms' || body.channel === 'whatsapp')) {
    const recipient = body.to_addr ?? ticket.contact_phone
    if (!recipient) {
      return NextResponse.json({ error: 'No contact phone on this ticket' }, { status: 400 })
    }

    let sid: string
    try {
      sid = body.channel === 'whatsapp'
        ? await sendWhatsAppStrict(recipient, body.body)
        : await sendSMSStrict(recipient, body.body)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `${body.channel.toUpperCase()} send failed: ${msg}` }, { status: 500 })
    }

    const fromAddr = body.channel === 'whatsapp'
      ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER ?? process.env.TWILIO_PHONE_NUMBER}`
      : (process.env.TWILIO_PHONE_NUMBER ?? 'maia')

    const message = await appendMessage(ticketId, {
      direction:   'outbound',
      channel:     body.channel,
      from_addr:   fromAddr,
      to_addr:     recipient,
      body:        body.body,
      external_id: sid,
    })
    return NextResponse.json({ message })
  }

  return NextResponse.json(
    { error: `Outbound on channel '${body.channel}' is not implemented yet` },
    { status: 501 },
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
