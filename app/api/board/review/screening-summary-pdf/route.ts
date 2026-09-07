// GET /api/board/review/screening-summary-pdf?token=...&subjectId=...
//
// Board-facing counterpart to app/api/admin/pre-apply/[id]/screening-
// summary-pdf/route.ts -- same colorful one-page summary PDF
// (lib/screening-summary-pdf.tsx), same "separate from Checkr's own
// report, never a replacement" framing, authenticated the same way the
// rest of the board review page is (the review row's own token, or the
// staff preview session). Never the actual FCRA consumer report.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { renderToBuffer } from '@react-pdf/renderer'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { summarizeReport } from '@/lib/screening/report-summary'
import { ScreeningSummaryPdf } from '@/lib/screening-summary-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const token = sp.get('token')
  const previewId = sp.get('preview')
  const subjectId = sp.get('subjectId')
  if (!subjectId) return NextResponse.json({ error: 'subjectId required' }, { status: 400 })

  let applicationId: string | null = null
  if (previewId) {
    const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value
    const session = sessionToken ? await verifySession(sessionToken) : null
    if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    applicationId = previewId
  } else if (token) {
    const { data: review } = await supabaseAdmin.from('application_board_reviews').select('application_id').eq('token', token).maybeSingle()
    if (!review) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })
    applicationId = String(review.application_id)
  } else {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const { data: application } = await supabaseAdmin.from('applications')
    .select('association, unit').eq('id', applicationId).maybeSingle()
  const { data: subject } = await supabaseAdmin.from('screening_subjects')
    .select('name, report_data, checkr_report_id, completed_at')
    .eq('id', subjectId).eq('application_id', applicationId).maybeSingle()
  if (!subject) return NextResponse.json({ error: 'subject not found' }, { status: 404 })

  const summary = summarizeReport(subject.report_data as Record<string, unknown> | null)
  if (!summary) return NextResponse.json({ error: 'No report summary available to export yet.' }, { status: 400 })

  const unit = (application?.unit as string | null) ?? null
  const assocName = (application?.association as string | null) ?? null

  let pdf: Buffer
  try {
    pdf = await renderToBuffer(
      ScreeningSummaryPdf({
        applicantName: (subject.name as string | null) ?? 'Applicant',
        unitLine: [unit ? `Unit ${unit}` : null, assocName].filter(Boolean).join(' · ') || null,
        reportId: subject.checkr_report_id ? `rp_${'•'.repeat(8)}${String(subject.checkr_report_id).slice(-4)}` : null,
        pulledAt: subject.completed_at ? new Date(subject.completed_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
        summary,
      }),
    )
  } catch (err) {
    return NextResponse.json({ error: `PDF generation failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  const fileName = `Screening Summary - ${(subject.name as string | null) ?? 'Applicant'}.pdf`.replace(/[^\w.\- ]/g, '')
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' },
  })
}
