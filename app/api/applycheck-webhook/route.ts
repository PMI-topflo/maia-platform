// =====================================================================
// POST /api/applycheck-webhook
//
// Inbound background-check results from Applycheck. trigger-applycheck opens
// one screening per subject, each with reference = applications.id and this
// URL as webhook_url, so Applycheck calls here (potentially once per subject)
// as results complete.
//
// We:
//   • optionally verify a shared secret (APPLYCHECK_WEBHOOK_SECRET) sent via
//     header or ?token= — set it in Applycheck's dashboard webhook config;
//   • resolve the application by the `reference` it echoes back;
//   • record the report link + reported status;
//   • ARCHIVE every raw payload in applications.applycheck_result so the
//     board-package step later has the full detail.
//
// ⚠ Applycheck's exact webhook payload shape is not verified here — the field
// extraction is defensive (tries several common key names). Confirm against
// Applycheck's webhook docs and tighten the mapping once a real sample is in
// hand. The raw payload is always archived, so nothing is lost meanwhile.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Pull the first present value across a list of candidate keys (top-level or
// nested under data/result/screening), treating the payload as untyped.
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const nests = [obj, obj.data, obj.result, obj.screening, obj.payload].filter(
    (o): o is Record<string, unknown> => !!o && typeof o === 'object',
  )
  for (const src of nests) for (const k of keys) {
    if (src[k] != null && src[k] !== '') return src[k]
  }
  return undefined
}

export async function POST(req: NextRequest) {
  // ── Optional shared-secret check ──────────────────────────────────────
  const secret = process.env.APPLYCHECK_WEBHOOK_SECRET
  if (secret) {
    const provided =
      req.headers.get('x-applycheck-signature') ||
      req.headers.get('x-webhook-secret') ||
      (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
      new URL(req.url).searchParams.get('token') ||
      ''
    if (provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    console.warn('[applycheck-webhook] APPLYCHECK_WEBHOOK_SECRET not set — accepting unauthenticated callback')
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const reference = pick(payload, ['reference', 'application_id', 'applicationId', 'metadata_reference'])
  const applicationId = typeof reference === 'string' ? reference : null
  if (!applicationId) {
    console.error('[applycheck-webhook] no application reference in payload', Object.keys(payload))
    return NextResponse.json({ error: 'Missing reference' }, { status: 400 })
  }

  const rawStatus  = pick(payload, ['status', 'result', 'decision', 'screening_status', 'outcome'])
  const reportUrl  = pick(payload, ['report_url', 'report', 'pdf_url', 'result_url', 'report_link'])

  // Load the current archive so we can append (one call may arrive per subject).
  const { data: app, error: fetchErr } = await supabase
    .from('applications')
    .select('id, applycheck_result')
    .eq('id', applicationId)
    .single()

  if (fetchErr || !app) {
    // Let Applycheck retry — the application should exist by the time results land.
    console.error('[applycheck-webhook] application not found for reference', applicationId)
    return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  }

  const prior = Array.isArray(app.applycheck_result)
    ? app.applycheck_result
    : app.applycheck_result
      ? [app.applycheck_result]
      : []
  prior.push({ received_at: new Date().toISOString(), payload })

  const update: Record<string, unknown> = {
    applycheck_result: prior,
    applycheck_completed_at: new Date().toISOString(),
  }
  if (typeof reportUrl === 'string') update.applycheck_report_url = reportUrl
  if (rawStatus != null)            update.applycheck_status = String(rawStatus).toLowerCase()

  const { error: updateErr } = await supabase
    .from('applications')
    .update(update)
    .eq('id', applicationId)

  if (updateErr) {
    console.error('[applycheck-webhook] update failed:', updateErr.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
