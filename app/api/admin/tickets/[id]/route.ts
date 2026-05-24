// =====================================================================
// app/api/admin/tickets/[id]/route.ts
// PATCH a ticket — status, priority, assignee, due_at, type, summary.
// Each meaningful change emits a ticket_events row via lib/tickets.
// =====================================================================

import { NextResponse } from 'next/server'
import { updateTicket, type TicketStatus, type TicketPriority, type TicketType } from '@/lib/tickets'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const VALID_STATUS:   TicketStatus[]   = ['open', 'pending', 'waiting_external', 'resolved', 'closed']
const VALID_PRIORITY: TicketPriority[] = ['low', 'normal', 'high', 'urgent']
const VALID_TYPE:     TicketType[]     = ['ticket', 'work_order']

interface PatchBody {
  status?:               TicketStatus
  priority?:             TicketPriority
  type?:                 TicketType
  assignee_email?:       string | null
  due_at?:               string | null
  subject?:              string | null
  summary?:              string | null
  work_order_type_id?:   number | null
  work_order_type_name?: string | null
  association_code?:     string | null
  unit_number?:          string | null
  is_board_request?:     boolean
  requested_by?:         string | null
  actor_email?:          string
  happened_at?:          string  // ISO datetime, for backdated audit events
  reason?:               string  // optional free-form note logged to ticket_events.payload
  // Soft archive controls. Sending `archive: true` sets archived_at = NOW();
  // `archive: false` restores (clears archived_at). Both emit an event.
  archive?:              boolean
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.status   && !VALID_STATUS  .includes(body.status))   return NextResponse.json({ error: 'Invalid status'   }, { status: 400 })
  if (body.priority && !VALID_PRIORITY.includes(body.priority)) return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  if (body.type     && !VALID_TYPE    .includes(body.type))     return NextResponse.json({ error: 'Invalid type'     }, { status: 400 })
  if (body.work_order_type_id !== undefined
      && body.work_order_type_id !== null
      && !(Number.isInteger(body.work_order_type_id) && body.work_order_type_id > 0)) {
    return NextResponse.json({ error: 'Invalid work_order_type_id' }, { status: 400 })
  }

  // Validate happened_at if provided (must be a parseable date, not in
  // the future, not absurdly far in the past).
  let happenedAtIso: string | undefined
  if (body.happened_at) {
    const t = new Date(body.happened_at)
    if (isNaN(t.getTime())) {
      return NextResponse.json({ error: 'Invalid happened_at' }, { status: 400 })
    }
    const now = Date.now()
    if (t.getTime() > now + 60_000) {  // 60s clock-skew tolerance
      return NextResponse.json({ error: 'happened_at cannot be in the future' }, { status: 400 })
    }
    happenedAtIso = t.toISOString()
  }

  try {
    const ticket = await updateTicket(
      ticketId,
      {
        status:               body.status,
        priority:             body.priority,
        type:                 body.type,
        assignee_email:       body.assignee_email,
        due_at:               body.due_at,
        subject:              body.subject,
        summary:              body.summary,
        work_order_type_id:   body.work_order_type_id,
        work_order_type_name: body.work_order_type_name,
        association_code:     body.association_code,
        unit_number:          body.unit_number,
        is_board_request:     body.is_board_request,
        requested_by:         body.requested_by,
      },
      body.actor_email ?? 'staff',
      { happened_at: happenedAtIso, reason: body.reason },
    )

    // Archive / restore — handled separately from updateTicket because
    // it's not a CINC-syncing field and we want a distinct audit event.
    if (body.archive !== undefined) {
      const archivedAt = body.archive ? new Date().toISOString() : null
      const { error: archErr } = await supabaseAdmin
        .from('tickets')
        .update({ archived_at: archivedAt })
        .eq('id', ticketId)
      if (archErr) {
        return NextResponse.json({ error: `archive update failed: ${archErr.message}` }, { status: 500 })
      }
      await supabaseAdmin.from('ticket_events').insert({
        ticket_id:   ticketId,
        actor_email: body.actor_email ?? 'staff',
        event_type:  body.archive ? 'archived' : 'restored',
        payload:     body.reason ? { reason: body.reason } : {},
      })
    }

    return NextResponse.json({ ticket })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId)) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  // Photos in the work-order-photos bucket are NOT cascade-deleted with
  // their work_order_attachments row, so we have to remove them first
  // to avoid orphaning blobs in storage.
  const { data: attachments } = await supabaseAdmin
    .from('work_order_attachments')
    .select('storage_path')
    .eq('ticket_id', ticketId)

  if (attachments && attachments.length > 0) {
    const paths = attachments.map(a => a.storage_path as string).filter(Boolean)
    if (paths.length > 0) {
      await supabaseAdmin.storage.from('work-order-photos').remove(paths)
    }
  }

  // CASCADE on the FKs handles ticket_events, ticket_messages,
  // work_order_details, work_order_attachments rows themselves.
  const { error } = await supabaseAdmin
    .from('tickets')
    .delete()
    .eq('id', ticketId)

  if (error) {
    return NextResponse.json({ error: `delete failed: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
