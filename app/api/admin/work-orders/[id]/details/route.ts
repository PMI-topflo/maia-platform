// =====================================================================
// PATCH /api/admin/work-orders/[id]/details
//
// Update scheduled_at and/or vendor on a work order's details row.
// Both flow back to CINC via the outbox 'update_details' op (which
// hits PATCH /workOrderDetails with the new IssuedDate / VendorId).
//
// Body shape:
//   { scheduled_at?: ISO string | null,
//     vendor_id?:    number    | null,
//     vendor_name?:  string    | null }
//
// At least one of these must be present.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { enqueueOutbox } from '@/lib/tickets'

export const runtime = 'nodejs'

interface PatchBody {
  scheduled_at?: string | null
  vendor_id?:    number | null
  vendor_name?:  string | null
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = await req.json() as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const hasSched  = body.scheduled_at !== undefined
  const hasVendor = body.vendor_id    !== undefined
  if (!hasSched && !hasVendor) {
    return NextResponse.json({ error: 'Provide scheduled_at or vendor_id' }, { status: 400 })
  }

  // Validate scheduled_at if provided.
  let scheduledIso: string | null | undefined
  if (hasSched) {
    if (body.scheduled_at === null) {
      scheduledIso = null
    } else {
      const t = new Date(body.scheduled_at as string)
      if (isNaN(t.getTime())) {
        return NextResponse.json({ error: 'Invalid scheduled_at' }, { status: 400 })
      }
      scheduledIso = t.toISOString()
    }
  }

  // Validate vendor_id if provided.
  if (hasVendor && body.vendor_id !== null && !Number.isInteger(body.vendor_id)) {
    return NextResponse.json({ error: 'Invalid vendor_id' }, { status: 400 })
  }

  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from('tickets')
    .select('id, type, cinc_workorder_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (ticketErr) {
    return NextResponse.json({ error: `lookup failed: ${ticketErr.message}` }, { status: 500 })
  }
  if (!ticket || ticket.type !== 'work_order') {
    return NextResponse.json({ error: 'Not a work order' }, { status: 404 })
  }

  // Upsert the details row so this works even when no row exists yet
  // (e.g. MAIA-created orphans before the inbound sync populated one).
  const update: Record<string, unknown> = { ticket_id: ticketId }
  if (hasSched)  update.scheduled_at   = scheduledIso
  if (hasVendor) update.cinc_vendor_id = body.vendor_id
  if (body.vendor_name !== undefined) update.vendor_name = body.vendor_name ?? null

  const { error: upErr } = await supabaseAdmin
    .from('work_order_details')
    .upsert(update, { onConflict: 'ticket_id' })
  if (upErr) {
    return NextResponse.json({ error: `details upsert failed: ${upErr.message}` }, { status: 500 })
  }

  // Log to the timeline so the audit trail captures the change.
  const eventType = hasVendor ? 'vendor_changed' : 'scheduled_changed'
  const payload: Record<string, unknown> = {}
  if (hasSched)  payload.scheduled_at = scheduledIso
  if (hasVendor) { payload.vendor_id = body.vendor_id; payload.vendor_name = body.vendor_name ?? null }
  await supabaseAdmin.from('ticket_events').insert({
    ticket_id:   ticketId,
    actor_email: 'staff',
    event_type:  eventType,
    payload,
  })

  // Push to CINC if synced.
  if (ticket.cinc_workorder_id && process.env.CINC_SYNC_ENABLED === 'true') {
    await enqueueOutbox(ticketId, 'ticket', 'update_details', 'cinc')
  }

  return NextResponse.json({ ok: true, queued_for_cinc: !!ticket.cinc_workorder_id })
}
