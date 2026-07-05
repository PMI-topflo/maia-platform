// =====================================================================
// POST /api/screening/[subjectId]/consent   { applicationId }
// Called by the browser once the Checkr Disclosure & Consent Embed reports
// the candidate has completed consent for this subject. Records consent,
// then creates the Checkr Report — Checkr requires consent to exist before
// a Report can be created, so this MUST happen in that order.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { screening } from '@/lib/screening'
import { computeAggregateStatus } from '@/lib/screening/aggregate'

export async function POST(req: NextRequest, ctx: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await ctx.params
  let body: { applicationId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!body.applicationId) return NextResponse.json({ error: 'applicationId required' }, { status: 400 })

  const { data: subject, error } = await supabase.from('screening_subjects')
    .select('*').eq('id', subjectId).eq('application_id', body.applicationId).maybeSingle()
  if (error || !subject) return NextResponse.json({ error: 'screening subject not found' }, { status: 404 })
  if (!subject.checkr_candidate_id) return NextResponse.json({ error: 'no candidate on file for this subject yet' }, { status: 409 })

  await supabase.from('screening_subjects').update({
    consented: true, consented_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', subjectId)

  try {
    const { reportId } = await screening.createReport(subject.checkr_candidate_id, {
      index: subject.subject_index, name: subject.name ?? '', email: subject.email ?? undefined,
      isCommercial: subject.is_commercial, isInternational: subject.is_international,
    })
    await supabase.from('screening_subjects').update({
      checkr_report_id: reportId, status: 'invited', updated_at: new Date().toISOString(),
    }).eq('id', subjectId)
  } catch (e) {
    console.error('[screening/consent] report creation failed:', e)
    await supabase.from('screening_subjects').update({ status: 'error', updated_at: new Date().toISOString() }).eq('id', subjectId)
  }

  const { data: subjectRows } = await supabase.from('screening_subjects').select('status').eq('application_id', body.applicationId)
  const aggregate = computeAggregateStatus((subjectRows ?? []).map(r => r.status as string))
  await supabase.from('applications').update({ screening_status: aggregate }).eq('id', body.applicationId)

  return NextResponse.json({ ok: true, status: aggregate })
}
