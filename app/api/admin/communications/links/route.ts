// =====================================================================
// /api/admin/communications/links
//
// POST   — link a communication (conversation or email) to a ticket
// DELETE — remove an existing link (by row id)
// GET    — bulk-fetch links for many communications in one round-trip
//
// All endpoints are staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LinkBody {
  communication_type: 'conversation' | 'email'
  communication_id:   string
  ticket_id:          number
}

async function requireStaff(): Promise<{ ok: true; email: string } | { ok: false; res: NextResponse }> {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const email = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : 'staff'
  return { ok: true, email }
}

export async function POST(req: Request) {
  const guard = await requireStaff()
  if (!guard.ok) return guard.res

  let body: LinkBody
  try {
    body = await req.json() as LinkBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.communication_type !== 'conversation' && body.communication_type !== 'email') {
    return NextResponse.json({ error: 'Invalid communication_type' }, { status: 400 })
  }
  if (!body.communication_id || typeof body.communication_id !== 'string') {
    return NextResponse.json({ error: 'Invalid communication_id' }, { status: 400 })
  }
  if (!Number.isInteger(body.ticket_id) || body.ticket_id <= 0) {
    return NextResponse.json({ error: 'Invalid ticket_id' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('communication_ticket_links')
    .insert({
      communication_type: body.communication_type,
      communication_id:   body.communication_id,
      ticket_id:          body.ticket_id,
      linked_by_email:    guard.email,
    })
    .select('id, ticket_id, linked_at')
    .single()

  if (error) {
    // 23505 = unique-constraint violation → link already exists, no-op
    if (String(error.code) === '23505') {
      return NextResponse.json({ ok: true, already_linked: true })
    }
    return NextResponse.json({ error: `link failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, link: data })
}

export async function DELETE(req: Request) {
  const guard = await requireStaff()
  if (!guard.ok) return guard.res

  const url = new URL(req.url)
  const id  = Number(url.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid link id' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('communication_ticket_links')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: `unlink failed: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function GET(req: Request) {
  const guard = await requireStaff()
  if (!guard.ok) return guard.res

  const url   = new URL(req.url)
  const type  = url.searchParams.get('type')
  const idsCsv = url.searchParams.get('ids') ?? ''
  if (type !== 'conversation' && type !== 'email') {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }
  const ids = idsCsv.split(',').map(s => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    return NextResponse.json({ links: {} })
  }

  const { data, error } = await supabaseAdmin
    .from('communication_ticket_links')
    .select('id, communication_id, ticket_id, linked_at, linked_by_email, tickets!inner(ticket_number, subject, type, status)')
    .eq('communication_type', type)
    .in('communication_id', ids)

  if (error) {
    return NextResponse.json({ error: `fetch failed: ${error.message}` }, { status: 500 })
  }

  // Group by communication_id for the UI.
  const links: Record<string, Array<{
    id:               number
    ticket_id:        number
    ticket_number:    string
    subject:          string | null
    type:             string
    status:           string
    linked_at:        string
    linked_by_email:  string | null
  }>> = {}
  for (const row of (data ?? []) as Array<{
    id:               number
    communication_id: string
    ticket_id:        number
    linked_at:        string
    linked_by_email:  string | null
    tickets:          { ticket_number: string; subject: string | null; type: string; status: string } | Array<{ ticket_number: string; subject: string | null; type: string; status: string }>
  }>) {
    const t = Array.isArray(row.tickets) ? row.tickets[0] : row.tickets
    if (!t) continue
    const arr = links[row.communication_id] ?? []
    arr.push({
      id:               row.id,
      ticket_id:        row.ticket_id,
      ticket_number:    t.ticket_number,
      subject:          t.subject,
      type:             t.type,
      status:           t.status,
      linked_at:        row.linked_at,
      linked_by_email:  row.linked_by_email,
    })
    links[row.communication_id] = arr
  }

  return NextResponse.json({ links })
}
