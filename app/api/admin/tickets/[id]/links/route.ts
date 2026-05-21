// =====================================================================
// /api/admin/tickets/[id]/links
//
// Relate one ticket / work order to another.
//   GET    → list the tickets related to [id]
//   POST   { related_ticket_id }  → add a link
//   DELETE ?related_ticket_id=    → remove a link
//
// The link is undirected — stored once with the smaller id first so
// A-B and B-A are the same row.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireStaff() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

/** Tickets related to `ticketId`, with the display fields the UI needs. */
async function relatedTickets(ticketId: number) {
  const { data: links } = await supabaseAdmin
    .from('ticket_links')
    .select('ticket_id, related_ticket_id')
    .or(`ticket_id.eq.${ticketId},related_ticket_id.eq.${ticketId}`)

  const otherIds = (links ?? []).map(l =>
    (l.ticket_id as number) === ticketId ? (l.related_ticket_id as number) : (l.ticket_id as number),
  )
  if (otherIds.length === 0) return []

  const { data: tickets } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, type, status, subject, association_code')
    .in('id', otherIds)
    .order('created_at', { ascending: false })
  return tickets ?? []
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ticketId = Number((await ctx.params).id)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }
  return NextResponse.json({ links: await relatedTickets(ticketId) })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ticketId = Number((await ctx.params).id)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  let body: { related_ticket_id?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const relatedId = Number(body.related_ticket_id)
  if (!Number.isFinite(relatedId) || relatedId <= 0) {
    return NextResponse.json({ error: 'related_ticket_id is required' }, { status: 400 })
  }
  if (relatedId === ticketId) {
    return NextResponse.json({ error: 'A ticket cannot be linked to itself' }, { status: 400 })
  }

  // Both ends must exist.
  const { data: found } = await supabaseAdmin
    .from('tickets')
    .select('id')
    .in('id', [ticketId, relatedId])
  if ((found ?? []).length !== 2) {
    return NextResponse.json({ error: 'One of the tickets does not exist' }, { status: 404 })
  }

  // Store the pair smaller-id-first so A-B and B-A collapse to one row.
  const lo = Math.min(ticketId, relatedId)
  const hi = Math.max(ticketId, relatedId)
  const { error } = await supabaseAdmin
    .from('ticket_links')
    .insert({
      ticket_id:         lo,
      related_ticket_id: hi,
      created_by_email:  typeof session.userId === 'string' ? session.userId.toLowerCase() : null,
    })
  // 23505 = already linked — treat as success (idempotent).
  if (error && error.code !== '23505') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, links: await relatedTickets(ticketId) })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ticketId = Number((await ctx.params).id)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }
  const relatedId = Number(new URL(req.url).searchParams.get('related_ticket_id'))
  if (!Number.isFinite(relatedId) || relatedId <= 0) {
    return NextResponse.json({ error: 'related_ticket_id is required' }, { status: 400 })
  }

  const lo = Math.min(ticketId, relatedId)
  const hi = Math.max(ticketId, relatedId)
  const { error } = await supabaseAdmin
    .from('ticket_links')
    .delete()
    .eq('ticket_id', lo)
    .eq('related_ticket_id', hi)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, links: await relatedTickets(ticketId) })
}
