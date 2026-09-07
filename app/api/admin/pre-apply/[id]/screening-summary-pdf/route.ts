// GET /api/admin/pre-apply/[id]/screening-summary-pdf?subjectId=...
//
// A colorful, MAIA-branded ONE-PAGE SUMMARY PDF of a completed Checkr
// report (lib/screening-summary-pdf.tsx) -- a SEPARATE export from
// Checkr's own report PDF, which stays the retained, unaltered FCRA
// consumer report ("View report" link, unchanged). User direction,
// 2026-09-07: "let's also use it for the PDF download" -- confirmed as
// an ADDITION alongside the original, never a replacement for it, after
// flagging that the original carries required disclosures this summary
// doesn't attempt to reproduce. Staff-only.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { summarizeReport } from '@/lib/screening/report-summary'
import { ScreeningSummaryPdf } from '@/lib/screening-summary-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const subjectId = new URL(req.url).searchParams.get('subjectId')
  if (!subjectId) return NextResponse.json({ error: 'subjectId required' }, { status: 400 })

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('detailed_application_id, unit_label, association_code').eq('id', id).maybeSingle()
  if (!app?.detailed_application_id) return NextResponse.json({ error: 'no linked application' }, { status: 404 })

  const { data: subject } = await supabaseAdmin.from('screening_subjects')
    .select('name, report_data, checkr_report_id, completed_at')
    .eq('id', subjectId).eq('application_id', app.detailed_application_id).maybeSingle()
  if (!subject) return NextResponse.json({ error: 'subject not found' }, { status: 404 })

  const summary = summarizeReport(subject.report_data as Record<string, unknown> | null)
  if (!summary) return NextResponse.json({ error: 'No report summary available to export yet.' }, { status: 400 })

  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('association_name').eq('association_code', String(app.association_code)).maybeSingle()
  const unit = (app.unit_label as string | null) ?? null
  const assocName = (assoc?.association_name as string | null) ?? String(app.association_code)

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
