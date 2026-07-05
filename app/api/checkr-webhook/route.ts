// =====================================================================
// POST /api/checkr-webhook
// Inbound Checkr Tenant API order/report events. Resolved by
// checkr_order_id (the Tenant API's only identifier — no separate
// candidate/report split). Re-fetches authoritative order status via
// GET /orders/{id} rather than trusting the webhook payload's own fields,
// since the exact payload shape isn't confirmed against a real capture yet.
//
// Signature: `Tenant-Signature: t=<unix_ts>,v1=<hex hmac-sha256("t.rawbody")>`
// — confirmed against https://checkr-tenant-api-docs.redocly.app/webhooks
// 2026-07-05 (this replaces an earlier, incorrect guess of a plain
// X-Checkr-Signature header with no timestamp component).
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { screening } from '@/lib/screening'
import { computeAggregateStatus } from '@/lib/screening/aggregate'

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
  if (!screening.verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try { payload = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const event = screening.parseWebhookEvent(payload)
  if (!event.orderId) {
    console.error('[checkr-webhook] no order id in payload', event.type)
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 })
  }

  const { data: subject, error: fetchErr } = await supabase.from('screening_subjects')
    .select('id, application_id, result').eq('checkr_order_id', event.orderId).maybeSingle()

  if (fetchErr || !subject) {
    // Let Checkr retry — the subject row should exist by the time events land.
    console.error('[checkr-webhook] no screening_subjects row for order', event.orderId)
    return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  }

  // Re-fetch authoritative status rather than trusting the webhook body.
  let checkrStatus = event.status ?? 'pending'
  try {
    const order = await screening.getOrder(event.orderId)
    checkrStatus = order.status
  } catch (e) {
    console.error('[checkr-webhook] getOrder failed, falling back to payload status:', e)
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

  const { data: subjectRows } = await supabase.from('screening_subjects').select('status').eq('application_id', subject.application_id)
  const aggregate = computeAggregateStatus((subjectRows ?? []).map(r => r.status as string))
  const appUpdate: Record<string, unknown> = { screening_status: aggregate }
  if (aggregate === 'complete') appUpdate.screening_completed_at = new Date().toISOString()
  await supabase.from('applications').update(appUpdate).eq('id', subject.application_id)

  return NextResponse.json({ ok: true })
}
