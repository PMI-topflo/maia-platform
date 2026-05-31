// =====================================================================
// POST /api/addon/tickets/[id]/draft
//
// Returns an AI-drafted reply for a ticket WITHOUT sending it — the
// add-on shows it in the sidebar for the staffer to edit + insert into
// their Gmail compose. (The send happens natively in Gmail; SENT-capture
// records it back onto the ticket.)
//
// Body (optional): { instruction?: string }  — extra guidance for the draft.
// Auth: add-on bearer token.
// =====================================================================

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { addonStaffEmail } from '@/lib/addon-token'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MODEL = 'claude-sonnet-4-20250514'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'drafting not configured' }, { status: 503 })
  }

  let instruction = ''
  try { instruction = String((await req.json())?.instruction ?? '').slice(0, 1000) } catch { /* optional */ }

  // Ticket + recent thread (oldest→newest for the prompt).
  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, type, subject, summary, association_code, persona, contact_name, contact_email')
    .eq('id', id)
    .single()
  if (!ticket) return NextResponse.json({ error: 'ticket not found' }, { status: 404 })

  const { data: msgs } = await supabaseAdmin
    .from('ticket_messages')
    .select('direction, from_addr, subject, body, created_at')
    .eq('ticket_id', id)
    .order('created_at', { ascending: false })
    .limit(12)
  const thread = (msgs ?? []).reverse()

  const transcript = thread.length
    ? thread.map(m => `[${m.direction}] ${m.from_addr ?? ''}: ${(m.body ?? '').slice(0, 1500)}`).join('\n\n')
    : `(no messages yet) Subject: ${ticket.subject ?? ''}\n${ticket.summary ?? ''}`

  const system = [
    'You are MAIA, drafting a reply on behalf of PMI Top Florida Properties staff (a South Florida HOA/condo management company).',
    'Write a concise, professional, friendly email reply IN ENGLISH to the most recent inbound message in the thread below.',
    'Do not invent facts (balances, dates, vendor names) that are not in the thread. Where info is missing, ask for it or say it will be confirmed.',
    'Output ONLY the email body text — no subject line, no "Draft:" preamble, no markdown.',
  ].join(' ')

  const user = [
    `Ticket ${ticket.ticket_number} (${ticket.type})`,
    ticket.association_code ? `Association: ${ticket.association_code}` : '',
    ticket.contact_name || ticket.contact_email ? `Contact: ${ticket.contact_name ?? ''} <${ticket.contact_email ?? ''}>` : '',
    instruction ? `\nStaff instruction for this draft: ${instruction}` : '',
    `\n--- Thread (oldest to newest) ---\n${transcript}`,
  ].filter(Boolean).join('\n')

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const draftText = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
    return NextResponse.json({ draftText })
  } catch (err) {
    return NextResponse.json({ error: `draft failed: ${(err as Error).message}` }, { status: 502 })
  }
}
