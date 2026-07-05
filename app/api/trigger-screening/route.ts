// =====================================================================
// POST /api/trigger-screening   (internal — x-internal-secret)
// Replaces the dead trigger-applycheck (ApplyCheck had no public API).
// Self-Hosted Flow (Option 3): create a Checkr Candidate per subject now,
// but do NOT create the Report yet — consent must be captured first via
// the Disclosure & Consent Embed (see /api/screening/[subjectId]/consent).
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { screening } from '@/lib/screening'
import { computeAggregateStatus } from '@/lib/screening/aggregate'

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

  type Subject = { index: number; name: string; email?: string; dob?: string; ssn?: string; isCommercial: boolean }
  const subjects: Subject[] = []

  if (app.app_type === 'commercial') {
    (app.principals || []).forEach((p: Record<string, string>, i: number) => {
      subjects.push({ index: i, name: p.name, dob: p.dob, isCommercial: true })
    })
  } else {
    (app.applicants || []).forEach((a: Record<string, string>, i: number) => {
      subjects.push({
        index: i, name: `${a.firstName} ${a.lastName}`.trim(),
        email: a.email, dob: a.dob, ssn: a.ssn, isCommercial: false,
      })
    })
  }

  const results = await Promise.allSettled(
    subjects.map(async s => {
      const { candidateId } = await screening.createCandidate(s)
      const { error: upErr } = await supabase.from('screening_subjects').upsert({
        application_id: applicationId, subject_index: s.index, name: s.name, email: s.email ?? null,
        is_commercial: s.isCommercial, checkr_candidate_id: candidateId, status: 'awaiting_consent',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'application_id,subject_index' })
      if (upErr) throw new Error(`screening_subjects upsert: ${upErr.message}`)
      return candidateId
    }),
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  for (const r of results) if (r.status === 'rejected') console.error('[trigger-screening] candidate creation failed:', r.reason)

  // Any subject we couldn't even create a candidate for is recorded as an error.
  if (failed > 0) {
    await supabase.from('screening_subjects')
      .update({ status: 'error' }).eq('application_id', applicationId).eq('status', 'pending')
  }

  const { data: subjectRows } = await supabase.from('screening_subjects').select('status').eq('application_id', applicationId)
  const aggregate = computeAggregateStatus((subjectRows ?? []).map(r => r.status as string))
  await supabase.from('applications').update({ screening_status: aggregate, screening_provider: screening.name }).eq('id', applicationId)

  return NextResponse.json({ ok: true, subjects: subjects.length, succeeded, failed, status: aggregate })
}
