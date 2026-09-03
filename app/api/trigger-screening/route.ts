// =====================================================================
// POST /api/trigger-screening   (internal — x-internal-secret)
// Replaces the dead trigger-applycheck (ApplyCheck had no public API).
// Checkr's real Tenant Screening API creates the whole order in one call —
// applicant + property + package — there is no separate consent step to
// defer here. Once the order exists, Checkr emails the applicant a link to
// their own hosted page to complete consent/questionnaire.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { screening } from '@/lib/screening'
import { computeAggregateStatus } from '@/lib/screening/aggregate'
import type { ScreeningProperty } from '@/lib/screening/types'
import { sendEmail } from '@/lib/gmail'

const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret')
  if (process.env.INTERNAL_API_SECRET && secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { applicationId } = await req.json()
  if (!applicationId) return NextResponse.json({ error: 'applicationId required' }, { status: 400 })

  if (!screening.isConfigured()) {
    return NextResponse.json({ error: `${screening.name} credentials not configured` }, { status: 503 })
  }

  const { data: app, error } = await supabase.from('applications').select('*').eq('id', applicationId).single()
  if (error || !app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  if (app.stripe_payment_status !== 'paid') {
    return NextResponse.json({ error: 'Payment not confirmed' }, { status: 400 })
  }

  // applications.association stores the association NAME (selected from the
  // same dropdown that populates it), not a code — resolve the street
  // address needed for the Checkr order's required `property` object.
  const { data: assocRow } = await supabase.from('associations')
    .select('association_name, principal_address, city, state, zip')
    .eq('association_name', app.association).maybeSingle()
  if (!assocRow?.principal_address) {
    return NextResponse.json({ error: `Could not resolve a street address for association "${app.association}"` }, { status: 500 })
  }
  const unit = app.app_type === 'commercial'
    ? (app.principals?.[0]?.unit ?? null)
    : (app.applicants?.[0]?.unitApplying ?? null)
  const property: ScreeningProperty = {
    name: assocRow.association_name, street: assocRow.principal_address, unit,
    city: assocRow.city, state: assocRow.state, zipcode: assocRow.zip,
  }

  type Subject = { index: number; name: string; email?: string; dob?: string; ssn?: string; isCommercial: boolean; isInternational: boolean; addOnProducts?: string[] }
  const subjects: Subject[] = []

  if (app.app_type === 'commercial') {
    (app.principals || []).forEach((p: Record<string, string>, i: number) => {
      subjects.push({ index: i, name: p.name, dob: p.dob, isCommercial: true, isInternational: false })
    })
  } else {
    const isInternational = app.app_type === 'international';
    // addOnProducts is only ever present on a create-test diagnostic
    // applicant (see create-test/route.ts) -- real applicants never carry
    // it, so this stays undefined for production orders.
    (app.applicants || []).forEach((a: Record<string, unknown>, i: number) => {
      subjects.push({
        index: i, name: `${a.firstName} ${a.lastName}`.trim(),
        email: a.email as string | undefined, dob: a.dob as string | undefined, ssn: a.ssn as string | undefined,
        isCommercial: false, isInternational,
        addOnProducts: Array.isArray(a.addOnProducts) ? a.addOnProducts as string[] : undefined,
      })
    })
  }

  // Adult "Additional Occupant" rows (docs/ROADMAP.md's "Roster-based
  // applicant/occupant pricing") get their own real Checkr order too, same as
  // any other applicant -- this used to be promised in the UI copy and never
  // actually done. A minor occupant (isAdult !== 'yes') is never a subject
  // here, on any app_type, commercial included.
  const occupantIndexBase = subjects.length
  ;(app.occupants || []).filter((o: Record<string, unknown>) => o.isAdult === 'yes').forEach((o: Record<string, unknown>, i: number) => {
    subjects.push({
      index: occupantIndexBase + i, name: o.name as string,
      email: o.email as string | undefined, dob: o.dob as string | undefined, ssn: o.ssn as string | undefined,
      isCommercial: false, isInternational: false,
    })
  })

  const results = await Promise.allSettled(
    subjects.map(async s => {
      const { orderId, status } = await screening.createOrder(s, property)
      const { error: upErr } = await supabase.from('screening_subjects').upsert({
        application_id: applicationId, subject_index: s.index, name: s.name, email: s.email ?? null,
        is_commercial: s.isCommercial, is_international: s.isInternational, checkr_order_id: orderId,
        status: status === 'completed' ? 'complete' : 'awaiting_applicant',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'application_id,subject_index' })
      if (upErr) throw new Error(`screening_subjects upsert: ${upErr.message}`)
      return orderId
    }),
  )

  // Staff asked, 2026-09-03, after having no idea what an applicant actually
  // received: Checkr sends its own consent-link email directly (no MAIA
  // template involved -- see this file's header) the moment an order is
  // created above, so this is a heads-up ahead of it, not a duplicate. Only
  // for subjects whose order actually succeeded and who have an email on
  // file; failures here never fail the request -- the order itself already
  // succeeded.
  await Promise.allSettled(
    subjects.map((s, i) => {
      if (results[i].status !== 'fulfilled' || !s.email) return Promise.resolve()
      const unitLine = property.unit ? ` (Unit ${property.unit})` : ''
      return sendEmail({
        to: s.email,
        subject: `Next step: complete your background check — ${assocRow.association_name}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
          <p>Hi${s.name ? ` ${esc(s.name)}` : ''},</p>
          <p>Your background/credit check for <strong>${esc(String(assocRow.association_name))}</strong>${esc(unitLine)} has started. You'll get a <strong>separate email directly from Checkr</strong> within a few minutes with a secure link to complete a short consent step — that email doesn't come from us, so please check your spam folder if you don't see it.</p>
          <p>Your application can't move forward until that step is complete, so please take care of it as soon as you can.</p>
        </div>`,
      }).catch(() => null)
    }),
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  // Real error text was previously only ever logged server-side (console.error
  // below) -- the caller (create-test's UI) had no way to show a staff member
  // WHY order creation failed, only that it did. Surfaced in the response so
  // it's visible directly on the page instead of requiring Vercel log access.
  const errors: string[] = []
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('[trigger-screening] order creation failed:', r.reason)
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
    }
  }

  // Any subject we couldn't even create an order for is recorded as an error.
  if (failed > 0) {
    await supabase.from('screening_subjects')
      .update({ status: 'error' }).eq('application_id', applicationId).eq('status', 'pending')
  }

  const { data: subjectRows } = await supabase.from('screening_subjects').select('status').eq('application_id', applicationId)
  const aggregate = computeAggregateStatus((subjectRows ?? []).map(r => r.status as string))
  await supabase.from('applications').update({ screening_status: aggregate, screening_provider: screening.name }).eq('id', applicationId)

  return NextResponse.json({ ok: true, subjects: subjects.length, succeeded, failed, status: aggregate, ...(errors.length ? { errors } : {}) })
}
