// =====================================================================
// POST /api/addon/tickets/[id]/link-email
//
// Link the currently-open Gmail email (by thread/message id) to an
// existing ticket from the add-on. Records a communication_ticket_links
// row (same as the dashboard's link feature) and drops an internal note
// on the ticket with the email's subject/sender + a Gmail deep link.
//
// The add-on only has the email's metadata (no body), so this records the
// association — to pull the full body onto a ticket, use "@maia append".
//
// Auth: add-on bearer token.
// =====================================================================

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { appendMessage } from '@/lib/tickets'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const ticketId = parseInt(id, 10)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body */ }
  const threadId  = String(body.gmailThreadId ?? '').trim()
  const messageId = String(body.gmailMessageId ?? '').trim()
  const subject   = String(body.subject ?? '').trim()
  const sender    = String(body.sender ?? '').trim().toLowerCase()
  const commId    = threadId || messageId
  if (!commId) return NextResponse.json({ error: 'no email reference' }, { status: 400 })

  const { data: ticket } = await supabaseAdmin
    .from('tickets').select('id, ticket_number').eq('id', ticketId).maybeSingle()
  if (!ticket) return NextResponse.json({ error: 'ticket not found' }, { status: 404 })

  // Idempotent link row (unique on communication_type+communication_id+ticket_id).
  const { error: linkErr } = await supabaseAdmin.from('communication_ticket_links').insert({
    communication_type: 'email',
    communication_id:   commId,
    ticket_id:          ticketId,
    linked_by_email:    staff,
  })
  const already = !!linkErr && (linkErr as { code?: string }).code === '23505'
  if (linkErr && !already) return NextResponse.json({ error: linkErr.message }, { status: 500 })

  // Note on the ticket (only on first link, to avoid duplicate notes).
  if (!already) {
    const deepLink = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(messageId || threadId)}`
    const note = `🔗 Linked email: "${subject || '(no subject)'}"${sender ? ` from ${sender}` : ''}.\nOpen in Gmail: ${deepLink}`
    await appendMessage(ticketId, { direction: 'internal_note', channel: 'internal', from_addr: staff, body: note }).catch(() => null)
    await supabaseAdmin.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticketId)
  }

  return NextResponse.json({ ok: true, ticket_number: ticket.ticket_number, already })
}
