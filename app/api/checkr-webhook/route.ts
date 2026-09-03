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
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
// Same fallback list lib/application-handoff.ts's HANDOFF_NOTIFY uses for
// the Tenant Evaluation handoff -- staff asked, 2026-09-03: "are we going to
// receive an email that the Checkr background check was received," and
// nothing did. Only fires on a TRANSITION into complete/error/partial (the
// prior aggregate is checked below), so a duplicate or unrelated webhook
// delivery after the fact doesn't re-notify.
const SCREENING_NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

function mapOrderStatus(checkrStatus: string): string {
  if (checkrStatus === 'completed') return 'complete'
  if (checkrStatus === 'canceled') return 'error'
  return 'awaiting_applicant'   // waiting_for_applicant | pending
}

async function notifyStaffOfScreeningResult(detailedApplicationId: string, aggregate: string): Promise<void> {
  if (!SCREENING_NOTIFY.length) return
  // screening_subjects.application_id bridges to the LEGACY public.applications
  // table -- the staff pre-apply URL needs listing_applications.id, walked
  // back the same way app/api/cron/screening-expiry-warnings/route.ts does.
  const [{ data: la }, { data: subjectRows }] = await Promise.all([
    supabase.from('listing_applications').select('id, association_code, unit_label')
      .eq('detailed_application_id', detailedApplicationId).maybeSingle(),
    supabase.from('screening_subjects').select('name, status').eq('application_id', detailedApplicationId).order('subject_index', { ascending: true }),
  ])
  if (!la) return   // not bridged to a staff-visible application -- nothing to link to

  const label = aggregate === 'complete' ? 'complete' : aggregate === 'error' ? 'failed' : 'partially complete'
  const icon = aggregate === 'complete' ? '✓' : '⚠'
  const unit = (la.unit_label as string | null) ? ` Unit ${la.unit_label}` : ''
  const rows = (subjectRows ?? []).map(s => `<li>${esc(String(s.name ?? 'Applicant'))} — ${esc(String(s.status))}</li>`).join('')

  await sendEmail({
    to: SCREENING_NOTIFY,
    subject: `${icon} Checkr background check ${label} — ${la.association_code}${unit}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
      <p>The Checkr background check for <strong>${esc(String(la.association_code))}${esc(unit)}</strong> is now <strong>${label}</strong>.</p>
      ${rows ? `<ul>${rows}</ul>` : ''}
      <p><a href="${APP}/admin/pre-apply/${la.id}">Open the application →</a></p>
    </div>`,
  }).catch(() => null)
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

  const [{ data: subjectRows }, { data: priorApp }] = await Promise.all([
    supabase.from('screening_subjects').select('status').eq('application_id', subject.application_id),
    supabase.from('applications').select('screening_status').eq('id', subject.application_id).maybeSingle(),
  ])
  const aggregate = computeAggregateStatus((subjectRows ?? []).map(r => r.status as string))
  const appUpdate: Record<string, unknown> = { screening_status: aggregate }
  if (aggregate === 'complete') appUpdate.screening_completed_at = new Date().toISOString()
  await supabase.from('applications').update(appUpdate).eq('id', subject.application_id)

  // Notify only on a real transition into a result staff need to act on --
  // otherwise a duplicate/unrelated webhook delivery after the fact would
  // re-send the same "complete" email every time.
  const priorAggregate = (priorApp?.screening_status as string | null) ?? null
  if (aggregate !== priorAggregate && ['complete', 'error', 'partial'].includes(aggregate)) {
    await notifyStaffOfScreeningResult(String(subject.application_id), aggregate)
  }

  return NextResponse.json({ ok: true })
}
