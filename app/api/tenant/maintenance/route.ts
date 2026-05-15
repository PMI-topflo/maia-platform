// =====================================================================
// app/api/tenant/maintenance/route.ts
// POST — create a ticket for a maintenance request submitted by an
// authenticated HOA tenant. Pre-fills contact info from the tenant
// record so staff have everything they need to dispatch.
//
// Tickets land as type='ticket' for now. When Rentvine integration is
// wired in, residential (inside-unit) requests will flow to that path
// — at which point this endpoint can promote the ticket to type=
// 'work_order' with the right work_order_type_id.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createTicket, appendMessage, type TicketPriority } from '@/lib/tickets'

export const dynamic = 'force-dynamic'

const VALID_PRIORITY: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

interface Body {
  subject?:   string
  body?:      string
  priority?:  TicketPriority
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'tenant') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: Body
  try { payload = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const subject  = (payload.subject ?? '').trim()
  const body     = (payload.body    ?? '').trim()
  const priority: TicketPriority = payload.priority && VALID_PRIORITY.includes(payload.priority) ? payload.priority : 'normal'
  if (!subject || !body) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  }

  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : ''
  const assocCode  = (session.associationCode || '').toUpperCase()
  if (!loginEmail || !assocCode) {
    return NextResponse.json({ error: 'Session missing tenant identity' }, { status: 400 })
  }

  // Look up the tenant to pre-fill contact info.
  const { data: tenant } = await supabaseAdmin
    .from('association_tenants')
    .select('first_name, last_name, email, phone, unit_number, association_code, association_name')
    .eq('association_code', assocCode)
    .ilike('email', loginEmail)
    .order('lease_start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant record not found for this session' }, { status: 404 })
  }

  const contactName = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') || 'HOA Tenant'

  // Prefix the subject with the unit number so staff see it at a glance
  // in the queue without having to open the ticket.
  const subjectWithUnit = tenant.unit_number ? `Unit ${tenant.unit_number} — ${subject}` : subject

  const ticket = await createTicket({
    type:             'ticket',
    channel_origin:   'web',
    priority,
    association_code: tenant.association_code,
    persona:          'tenant',
    contact_name:     contactName,
    contact_email:    tenant.email ?? loginEmail,
    contact_phone:    tenant.phone,
    subject:          subjectWithUnit,
    summary:          body.slice(0, 280),
  })

  // Capture the full description as an inbound message on the ticket
  // so the timeline carries it (subject + 280-char summary aren't
  // enough for a real maintenance description).
  await appendMessage(ticket.id, {
    direction:   'inbound',
    channel:     'web',
    from_addr:   tenant.email ?? loginEmail,
    to_addr:     null,
    subject:     subjectWithUnit,
    body,
    body_html:   null,
    attachments: [],
    external_id: null,
  })

  return NextResponse.json({ ok: true, ticket_id: ticket.id, ticket_number: ticket.ticket_number })
}
