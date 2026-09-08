// POST /api/admin/pre-apply/[id]/refile-report   { subjectId }
//
// Re-generates the merged (colorful cover + Checkr's original) PDF for an
// ALREADY-completed report and re-files it onto its applicant's own
// "Background / Credit Reports" checklist row -- the recovery path for a
// report that finished before either the auto-file (lib/screening/report-
// storage.ts's fileReportAsDocument, added 2026-09-07) or the colorful
// cover page (added 2026-09-08) existed. Re-downloads the PDF from Checkr
// by checkr_report_id rather than trusting the already-stored screening-
// reports copy's path guess, then reuses the exact same regeneration
// logic the webhook itself calls on a fresh completion. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { regenerateMergedReport } from '@/lib/screening/report-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let b: { subjectId?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!b.subjectId) return NextResponse.json({ error: 'subjectId required' }, { status: 400 })

  // Confirm this subject actually belongs to the application on the URL --
  // screening_subjects is keyed by the legacy applications.id, bridged via
  // listing_applications.detailed_application_id.
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('detailed_application_id').eq('id', id).maybeSingle()
  if (!app?.detailed_application_id) return NextResponse.json({ error: 'no linked application' }, { status: 404 })

  const { data: subject } = await supabaseAdmin.from('screening_subjects')
    .select('id, application_id, name, stakeholder_id, checkr_report_id, status')
    .eq('id', b.subjectId).eq('application_id', app.detailed_application_id).maybeSingle()
  if (!subject) return NextResponse.json({ error: 'subject not found' }, { status: 404 })
  if (!subject.checkr_report_id) return NextResponse.json({ error: 'No completed report on file for this applicant yet.' }, { status: 400 })

  try {
    await regenerateMergedReport({
      id: String(subject.id), application_id: String(subject.application_id),
      name: (subject.name as string | null) ?? null, stakeholder_id: (subject.stakeholder_id as string | null) ?? null,
      checkr_report_id: String(subject.checkr_report_id),
    })
  } catch (e) {
    return NextResponse.json({ error: `Could not re-file: ${(e as Error).message}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
