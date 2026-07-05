// =====================================================================
// POST /api/checkr-webhook
// Replaces the old /api/applycheck-webhook. Inbound Checkr candidate/report
// status events — resolve by checkr_candidate_id or checkr_report_id
// (Checkr doesn't echo back an arbitrary "reference" the way ApplyCheck's
// assumed payload did), update the matching screening_subjects row, archive
// the raw payload, and recompute the parent application's aggregate status.
//
// ⚠ Signature header name/scheme (X-Checkr-Signature, HMAC-SHA256 of the raw
// body) is Checkr's documented convention but hasn't been confirmed against
// a real captured webhook — verify against a live staging send before
// relying on it to reject forged requests in production.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { screening } from '@/lib/screening'
import { computeAggregateStatus } from '@/lib/screening/aggregate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-checkr-signature')
  if (!screening.verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try { payload = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const event = screening.parseWebhookEvent(payload)
  if (!event.candidateId && !event.reportId) {
    console.error('[checkr-webhook] no candidate_id or report_id in payload', event.type)
    return NextResponse.json({ error: 'Missing candidate/report id' }, { status: 400 })
  }

  let query = supabase.from('screening_subjects').select('id, application_id, result')
  query = event.reportId ? query.eq('checkr_report_id', event.reportId) : query.eq('checkr_candidate_id', event.candidateId as string)
  const { data: subject, error: fetchErr } = await query.maybeSingle()

  if (fetchErr || !subject) {
    // Let Checkr retry — the subject row should exist by the time results land.
    console.error('[checkr-webhook] no screening_subjects row for', event.candidateId, event.reportId)
    return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  }

  const prior = Array.isArray(subject.result) ? subject.result : subject.result ? [subject.result] : []
  prior.push({ received_at: new Date().toISOString(), type: event.type, payload })

  const update: Record<string, unknown> = { result: prior, updated_at: new Date().toISOString() }
  if (event.reportUrl) update.report_url = event.reportUrl
  if (event.status) update.status = event.status.toLowerCase()
  if (event.status && ['clear', 'complete', 'completed'].includes(event.status.toLowerCase())) {
    update.status = 'complete'
    update.completed_at = new Date().toISOString()
  }

  const { error: updateErr } = await supabase.from('screening_subjects').update(update).eq('id', subject.id)
  if (updateErr) {
    console.error('[checkr-webhook] update failed:', updateErr.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  const { data: subjectRows } = await supabase.from('screening_subjects').select('status').eq('application_id', subject.application_id)
  const aggregate = computeAggregateStatus((subjectRows ?? []).map(r => r.status as string))
  const appUpdate: Record<string, unknown> = { screening_status: aggregate }
  if (update.report_url) appUpdate.screening_report_url = update.report_url
  if (aggregate === 'complete') appUpdate.screening_completed_at = new Date().toISOString()
  await supabase.from('applications').update(appUpdate).eq('id', subject.application_id)

  return NextResponse.json({ ok: true })
}
