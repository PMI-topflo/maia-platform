// =====================================================================
// POST /api/checkr-webhook
// Inbound Checkr Tenant API order/report events. Resolved by
// checkr_order_id (the Tenant API's only identifier — no separate
// candidate/report split). Re-fetches authoritative order status via
// GET /orders/{id} rather than trusting the webhook payload's own fields
// (the real envelope has no status field anywhere -- confirmed 2026-07-06).
//
// Signature: `Tenant-Signature: t=<unix_ts>,v1=<hex hmac-sha256("t.rawbody")>`
// — confirmed live against a real captured payload 2026-07-06.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { screening } from '@/lib/screening'
import { computeAggregateStatus } from '@/lib/screening/aggregate'
import { storeAndLinkReport } from '@/lib/screening/report-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function mapOrderStatus(checkrStatus: string): string {
  if (checkrStatus === 'completed') return 'complete'
  if (checkrStatus === 'canceled') return 'error'
  return 'awaiting_applicant'   // waiting_for_applicant | pending
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('tenant-signature')

  // Checkr's dashboard "Test" action sends a bare connectivity probe — a POST
  // with no body and no signature — to confirm the URL is reachable. It's not
  // a real event and isn't retried, but it DOES require a 2xx response.
  // Confirmed via Checkr's own Webhooks guide 2026-07-06 (this must be
  // checked before signature verification, since there's nothing to verify).
  if (!rawBody && !signature) {
    return NextResponse.json({ ok: true, probe: true })
  }

  if (!screening.verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try { payload = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const event = screening.parseWebhookEvent(payload)
  if (!event.orderId) {
    // report.product.completed carries no order_id by design (its data is
    // only { id, report_id, product }) -- this is an expected event type we
    // don't act on, NOT an error. A non-2xx here would make Checkr retry it
    // forever with exponential backoff, per their delivery guarantees.
    console.log('[checkr-webhook] event with no resolvable order id, ignoring:', event.type)
    return NextResponse.json({ ok: true, ignored: event.type })
  }

  const { data: subject, error: fetchErr } = await supabase.from('screening_subjects')
    .select('id, application_id, result').eq('checkr_order_id', event.orderId).maybeSingle()

  if (fetchErr || !subject) {
    // Let Checkr retry — the subject row should exist by the time events land.
    console.error('[checkr-webhook] no screening_subjects row for order', event.orderId)
    return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  }

  // The webhook payload never carries a status field -- always re-fetch
  // authoritative state.
  let checkrStatus = 'pending'
  try {
    const order = await screening.getOrder(event.orderId)
    checkrStatus = order.status
  } catch (e) {
    console.error('[checkr-webhook] getOrder failed, defaulting to pending:', e)
  }

  const prior = Array.isArray(subject.result) ? subject.result : subject.result ? [subject.result] : []
  prior.push({ received_at: new Date().toISOString(), type: event.type, payload })

  const status = mapOrderStatus(checkrStatus)
  const update: Record<string, unknown> = { result: prior, status, updated_at: new Date().toISOString() }
  if (status === 'complete') update.completed_at = new Date().toISOString()

  const { error: updateErr } = await supabase.from('screening_subjects').update(update).eq('id', subject.id)
  if (updateErr) {
    console.error('[checkr-webhook] update failed:', updateErr.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  if (event.reportId) {
    try {
      await storeAndLinkReport({ id: subject.id, application_id: subject.application_id }, event.reportId)
    } catch (e) {
      // Don't fail the webhook over this -- status is already recorded above;
      // the PDF link can be backfilled separately if this errors.
      console.error('[checkr-webhook] report PDF store failed:', e)
    }
  }

  const { data: subjectRows } = await supabase.from('screening_subjects').select('status').eq('application_id', subject.application_id)
  const aggregate = computeAggregateStatus((subjectRows ?? []).map(r => r.status as string))
  const appUpdate: Record<string, unknown> = { screening_status: aggregate }
  if (aggregate === 'complete') appUpdate.screening_completed_at = new Date().toISOString()
  await supabase.from('applications').update(appUpdate).eq('id', subject.application_id)

  return NextResponse.json({ ok: true })
}
