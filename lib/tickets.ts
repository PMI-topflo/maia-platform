// =====================================================================
// lib/tickets.ts
//
// Ticket primitive used by every channel (email, SMS, WhatsApp, web,
// phone, internal). Wraps the tickets / ticket_messages / ticket_events
// tables with helpers for the two operations that matter at ingest time:
//
//   1. findOrCreateTicket — auto-threads inbound messages onto an open
//      ticket when possible (gmail thread → contact recency window →
//      else create a new ticket).
//
//   2. appendMessage      — adds a ticket_messages row, dedupes via the
//      unique (channel, external_id) constraint, refreshes ticket
//      summary/updated_at, and enqueues an outbox sync if the ticket is
//      a work_order.
//
// Status mutations go through updateTicket which always emits a
// ticket_events row for audit. SLA due_at is auto-computed from priority
// at create time (overridable later by staff via PATCH).
// =====================================================================

import { supabaseAdmin } from './supabase-admin'

export type TicketType     = 'ticket' | 'work_order'
export type TicketStatus   = 'open' | 'pending' | 'waiting_external' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketChannel  = 'email' | 'whatsapp' | 'sms' | 'web' | 'phone' | 'internal'
export type MessageDirection = 'inbound' | 'outbound' | 'internal_note'

export interface Ticket {
  id:                     number
  ticket_number:          string
  type:                   TicketType
  status:                 TicketStatus
  priority:               TicketPriority
  channel_origin:         TicketChannel
  association_code:       string | null
  persona:                string | null
  contact_name:           string | null
  contact_email:          string | null
  contact_phone:          string | null
  subject:                string | null
  summary:                string | null
  assignee_email:         string | null
  due_at:                 string | null
  resolved_at:            string | null
  gmail_thread_id:        string | null
  rentvine_workorder_id:  string | null
  cinc_workorder_id:      string | null
  work_order_type_id:     number | null
  work_order_type_name:   string | null
  sync_status:            Record<string, unknown>
  created_at:             string
  updated_at:             string
}

export interface TicketMessage {
  id:           number
  ticket_id:    number
  direction:    MessageDirection
  channel:      TicketChannel
  from_addr:    string | null
  to_addr:      string | null
  subject:      string | null
  body:         string | null
  body_html:    string | null
  attachments:  unknown[]
  external_id:  string | null
  created_at:   string
}

// ---------------------------------------------------------------------
// SLA defaults — staff can override due_at per ticket via PATCH.
// ---------------------------------------------------------------------
const SLA_HOURS_BY_PRIORITY: Record<TicketPriority, number> = {
  urgent: 4,
  high:   24,
  normal: 72,
  low:    168,
}

function dueAtFor(priority: TicketPriority): string {
  return new Date(Date.now() + SLA_HOURS_BY_PRIORITY[priority] * 3600_000).toISOString()
}

// ---------------------------------------------------------------------
// Lookups for auto-threading
// ---------------------------------------------------------------------
const OPEN_STATUSES: TicketStatus[] = ['open', 'pending', 'waiting_external']

export async function findOpenTicketByGmailThread(threadId: string): Promise<Ticket | null> {
  if (!threadId) return null
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .select('*')
    .eq('gmail_thread_id', threadId)
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[tickets] findOpenTicketByGmailThread error:', error.message)
    return null
  }
  return data as Ticket | null
}

/** Strip Re:/Fwd:, lowercase, collapse whitespace. Used for subject-match
 *  threading so "Plumbing leak" and "Re: Plumbing leak" link to one ticket. */
export function normalizeSubject(s: string | null | undefined): string {
  if (!s) return ''
  let out = s.trim()
  // Strip nested Re:/Fwd: prefixes
  for (let i = 0; i < 5; i++) {
    const stripped = out.replace(/^(re|fwd|fw)\s*:\s*/i, '')
    if (stripped === out) break
    out = stripped.trim()
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Find an open ticket with the same normalized subject from this contact in
 *  the recency window. Used so a second "ticket me X" email about the same
 *  issue appends to the existing ticket instead of creating a duplicate. */
export async function findOpenTicketBySubject(
  subject:      string | null | undefined,
  contactEmail: string | null | undefined,
  withinDays:   number = 30,
): Promise<Ticket | null> {
  const target = normalizeSubject(subject)
  if (!target || target.length < 5) return null
  const since  = new Date(Date.now() - withinDays * 86400_000).toISOString()

  let query = supabaseAdmin
    .from('tickets')
    .select('*')
    .in('status', OPEN_STATUSES)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (contactEmail) query = query.eq('contact_email', contactEmail.toLowerCase())

  const { data, error } = await query
  if (error) {
    console.error('[tickets] findOpenTicketBySubject error:', error.message)
    return null
  }
  for (const t of data ?? []) {
    if (normalizeSubject((t as Ticket).subject) === target) return t as Ticket
  }
  return null
}

export async function findOpenTicketByContact(opts: {
  email?:           string | null
  phone?:           string | null
  associationCode?: string | null
  withinDays?:      number
}): Promise<Ticket | null> {
  const withinDays = opts.withinDays ?? 14
  const since      = new Date(Date.now() - withinDays * 86400_000).toISOString()

  let query = supabaseAdmin
    .from('tickets')
    .select('*')
    .in('status', OPEN_STATUSES)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (opts.email)           query = query.eq('contact_email', opts.email.toLowerCase())
  else if (opts.phone)      query = query.eq('contact_phone', opts.phone)
  else                      return null

  if (opts.associationCode) query = query.eq('association_code', opts.associationCode)

  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[tickets] findOpenTicketByContact error:', error.message)
    return null
  }
  return data as Ticket | null
}

// ---------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------
export interface CreateTicketInput {
  type?:                 TicketType
  channel_origin:        TicketChannel
  priority?:             TicketPriority
  association_code?:     string | null
  persona?:              string | null
  contact_name?:         string | null
  contact_email?:        string | null
  contact_phone?:        string | null
  subject?:              string | null
  summary?:              string | null
  gmail_thread_id?:      string | null
  assignee_email?:       string | null
  work_order_type_id?:   number | null
  work_order_type_name?: string | null
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const priority = input.priority ?? 'normal'
  const row = {
    type:                 input.type ?? 'ticket',
    status:               'open' as TicketStatus,
    priority,
    channel_origin:       input.channel_origin,
    association_code:     input.association_code ?? null,
    persona:              input.persona ?? null,
    contact_name:         input.contact_name ?? null,
    contact_email:        input.contact_email?.toLowerCase() ?? null,
    contact_phone:        input.contact_phone ?? null,
    subject:              input.subject ?? null,
    summary:              input.summary ?? null,
    assignee_email:       input.assignee_email?.toLowerCase() ?? null,
    gmail_thread_id:      input.gmail_thread_id ?? null,
    due_at:               dueAtFor(priority),
    work_order_type_id:   input.work_order_type_id   ?? null,
    work_order_type_name: input.work_order_type_name ?? null,
  }
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .insert(row)
    .select('*')
    .single()
  if (error || !data) throw new Error(`createTicket failed: ${error?.message}`)

  await supabaseAdmin.from('ticket_events').insert({
    ticket_id:   data.id,
    actor_email: 'system',
    event_type:  'created',
    payload:     { channel_origin: row.channel_origin, type: row.type },
  })

  // Mirror new work orders into CINC + Rentvine via the outbox, so the
  // sync survives serverless cold-starts and can retry on transient
  // upstream failures. Each target is gated by its own env flag.
  if (data.type === 'work_order') {
    if (process.env.CINC_SYNC_ENABLED === 'true') {
      await enqueueOutbox(data.id, 'ticket', 'create', 'cinc')
    }
    if (process.env.RENTVINE_SYNC_ENABLED === 'true') {
      await enqueueOutbox(data.id, 'ticket', 'create', 'rentvine')
    }
  }

  return data as Ticket
}

export interface UpdateTicketPatch {
  status?:               TicketStatus
  priority?:             TicketPriority
  assignee_email?:       string | null
  subject?:              string | null
  summary?:              string | null
  due_at?:               string | null
  type?:                 TicketType
  work_order_type_id?:   number | null
  work_order_type_name?: string | null
}

export async function updateTicket(
  ticketId:    number,
  patch:       UpdateTicketPatch,
  actorEmail:  string = 'system',
): Promise<Ticket> {
  // Pull previous values so the audit row records the actual change.
  const { data: prev } = await supabaseAdmin
    .from('tickets')
    .select('status, priority, assignee_email, type, work_order_type_id, work_order_type_name')
    .eq('id', ticketId)
    .single()

  const update: Record<string, unknown> = { ...patch }
  if (patch.status === 'resolved' || patch.status === 'closed') {
    update.resolved_at = new Date().toISOString()
  }

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update(update)
    .eq('id', ticketId)
    .select('*')
    .single()
  if (error || !data) throw new Error(`updateTicket failed: ${error?.message}`)

  // Emit one event per meaningful field change so the timeline is precise.
  const events: Array<{ event_type: string; payload: Record<string, unknown> }> = []
  if (patch.status         && patch.status         !== prev?.status)         events.push({ event_type: 'status_changed',     payload: { from: prev?.status,         to: patch.status         } })
  if (patch.priority       && patch.priority       !== prev?.priority)       events.push({ event_type: 'priority_changed',   payload: { from: prev?.priority,       to: patch.priority       } })
  if (patch.assignee_email !== undefined && patch.assignee_email !== prev?.assignee_email) events.push({ event_type: 'assigned', payload: { from: prev?.assignee_email, to: patch.assignee_email } })
  if (patch.type           && patch.type           !== prev?.type)           events.push({ event_type: 'type_changed',       payload: { from: prev?.type,           to: patch.type           } })

  const woTypeChanged = patch.work_order_type_id !== undefined && patch.work_order_type_id !== prev?.work_order_type_id
  if (woTypeChanged) {
    events.push({
      event_type: 'work_order_type_changed',
      payload: {
        from_id:   prev?.work_order_type_id   ?? null,
        from_name: prev?.work_order_type_name ?? null,
        to_id:     patch.work_order_type_id   ?? null,
        to_name:   patch.work_order_type_name ?? null,
      },
    })
  }

  if (events.length) {
    await supabaseAdmin.from('ticket_events').insert(
      events.map(e => ({ ticket_id: ticketId, actor_email: actorEmail, ...e })),
    )
  }

  if (data.type === 'work_order') {
    if (process.env.RENTVINE_SYNC_ENABLED === 'true') {
      await enqueueOutbox(ticketId, 'ticket', 'update', 'rentvine')
    }
    if (process.env.CINC_SYNC_ENABLED === 'true') {
      await enqueueOutbox(ticketId, 'ticket', 'update', 'cinc')
      // Narrow operation that the outbox handler actually services today:
      // PATCH /workOrderDetails to mirror the WorkOrderTypeId we just set.
      // Only enqueue when the value actually changed AND the ticket has a
      // CINC work-order id to update.
      if (woTypeChanged && data.cinc_workorder_id) {
        await enqueueOutbox(ticketId, 'ticket', 'update_details', 'cinc')
      }
    }
  }

  return data as Ticket
}

// ---------------------------------------------------------------------
// Append message + auto-thread + outbox
// ---------------------------------------------------------------------
export interface AppendMessageInput {
  direction:    MessageDirection
  channel:      TicketChannel
  from_addr?:   string | null
  to_addr?:     string | null
  subject?:     string | null
  body?:        string | null
  body_html?:   string | null
  attachments?: unknown[]
  external_id?: string | null
}

/** Push a ticket's due_at and record why. Always emits a 'due_changed'
 *  ticket_events row carrying the from/to dates, the reason code/label
 *  (so the UI doesn't need to re-resolve it), the bucket
 *  ('external' = non-controllable / 'internal' = controllable, used by
 *  KPI reporting), and an optional free-text note. */
export async function changeDueDate(
  ticketId:   number,
  newDueAt:   string,
  reasonCode: string,
  reasonLabel: string,
  bucket:     'external' | 'internal',
  actorEmail: string,
  note?:      string | null,
): Promise<Ticket> {
  const { data: prev } = await supabaseAdmin
    .from('tickets')
    .select('due_at')
    .eq('id', ticketId)
    .single()

  const { data, error } = await supabaseAdmin
    .from('tickets')
    .update({ due_at: newDueAt })
    .eq('id', ticketId)
    .select('*')
    .single()
  if (error || !data) throw new Error(`changeDueDate failed: ${error?.message}`)

  await supabaseAdmin.from('ticket_events').insert({
    ticket_id:   ticketId,
    actor_email: actorEmail,
    event_type:  'due_changed',
    payload: {
      from:         prev?.due_at ?? null,
      to:           newDueAt,
      reason_code:  reasonCode,
      reason_label: reasonLabel,
      bucket,
      note:         note?.trim() || null,
    },
  })

  return data as Ticket
}

export async function appendMessage(
  ticketId: number,
  input:    AppendMessageInput,
): Promise<TicketMessage | null> {
  const row = {
    ticket_id:    ticketId,
    direction:    input.direction,
    channel:      input.channel,
    from_addr:    input.from_addr   ?? null,
    to_addr:      input.to_addr     ?? null,
    subject:      input.subject     ?? null,
    body:         input.body        ?? null,
    body_html:    input.body_html   ?? null,
    attachments:  input.attachments ?? [],
    external_id:  input.external_id ?? null,
  }

  const { data, error } = await supabaseAdmin
    .from('ticket_messages')
    .insert(row)
    .select('*')
    .single()

  // Dedupe: unique (channel, external_id) — we already have this message.
  if (error?.code === '23505') return null
  if (error || !data) {
    console.error('[tickets] appendMessage error:', error?.message)
    return null
  }

  // Touch the ticket so updated_at advances and dashboards re-sort.
  await supabaseAdmin
    .from('tickets')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', ticketId)

  await supabaseAdmin.from('ticket_events').insert({
    ticket_id:   ticketId,
    actor_email: input.from_addr ?? 'system',
    event_type:  'message_added',
    payload:     { direction: input.direction, channel: input.channel, external_id: input.external_id },
  })

  // Sync outbound staff replies + inbound external messages on work orders.
  if (input.direction !== 'internal_note') {
    await enqueueOutboxIfWorkOrder(ticketId, data.id as number)
  }

  return data as TicketMessage
}

// ---------------------------------------------------------------------
// findOrCreate — the main ingest helper
// ---------------------------------------------------------------------
export interface IngestInput extends CreateTicketInput {
  // Distinct from contact_email/phone in CreateTicketInput so callers can
  // pass them as the threading key without also setting them as the contact
  // (they're the same in practice today, kept separate for future flexibility).
  thread_key_email?: string | null
  thread_key_phone?: string | null
  withinDays?:       number
}

export async function findOrCreateTicket(input: IngestInput): Promise<Ticket> {
  // 1. Gmail thread match (strongest signal — same conversation by header).
  if (input.gmail_thread_id) {
    const byThread = await findOpenTicketByGmailThread(input.gmail_thread_id)
    if (byThread) return byThread
  }

  // 2. Contact + association recency match — same person within window.
  const contactEmail = input.thread_key_email ?? input.contact_email ?? null
  const contactPhone = input.thread_key_phone ?? input.contact_phone ?? null
  if (contactEmail || contactPhone) {
    const byContact = await findOpenTicketByContact({
      email:           contactEmail,
      phone:           contactPhone,
      associationCode: input.association_code,
      withinDays:      input.withinDays,
    })
    if (byContact) return byContact
  }

  // 3. New ticket.
  return createTicket(input)
}

// ---------------------------------------------------------------------
// Integration outbox
// ---------------------------------------------------------------------
export async function enqueueOutbox(
  entityId:   number,
  entityType: 'ticket' | 'ticket_message',
  operation:  'create' | 'update' | 'update_details' | 'append_message' | 'close',
  target:     'rentvine' | 'cinc' = 'rentvine',
  payload:    Record<string, unknown> = {},
): Promise<void> {
  // CINC stays opt-in until credentials arrive.
  if (target === 'cinc' && process.env.CINC_SYNC_ENABLED !== 'true') return

  const { error } = await supabaseAdmin.from('integration_outbox').insert({
    target,
    entity_type: entityType,
    entity_id:   entityId,
    operation,
    payload,
  })
  if (error) console.error('[tickets] enqueueOutbox error:', error.message)
}

async function enqueueOutboxIfWorkOrder(ticketId: number, messageId: number): Promise<void> {
  const { data } = await supabaseAdmin
    .from('tickets')
    .select('type')
    .eq('id', ticketId)
    .single()
  if (data?.type !== 'work_order') return

  // Each integration is gated by its own env flag so we can enable
  // CINC and Rentvine independently. Rentvine wiring lands once their
  // endpoint catalog is locked down.
  if (process.env.RENTVINE_SYNC_ENABLED === 'true') {
    await enqueueOutbox(messageId, 'ticket_message', 'append_message', 'rentvine')
  }
  if (process.env.CINC_SYNC_ENABLED === 'true') {
    await enqueueOutbox(messageId, 'ticket_message', 'append_message', 'cinc')
  }
}
