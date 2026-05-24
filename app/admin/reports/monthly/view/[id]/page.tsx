// =====================================================================
// /admin/reports/monthly/view/[id]
//
// Staff view of a saved monthly management report — a top action bar
// (back to builder, publish/un-publish, download PDF) and the
// newsletter document below. The audience-facing view of a published
// report lives at /report/[id]; both render the same article.
// =====================================================================

import { notFound } from 'next/navigation'
import Link from 'next/link'

import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ReportAudience } from '@/lib/monthly-report'
import { getFeedbackForReport, aggregateByAudience } from '@/lib/report-feedback'
import MonthlyReportArticle from '@/components/MonthlyReportArticle'
import PublishPanel from '../../PublishPanel'
import SendReportPanel from './SendReportPanel'
import FeedbackPanel from './FeedbackPanel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Monthly Report — PMI Top Florida' }

interface ReportRow {
  id:                 string
  association_code:   string
  month:              string
  report_markdown:    string
  generated_by_email: string | null
  generated_at:       string
  published_at:       string | null
  published_audience: ReportAudience | null
  published_by_email: string | null
}

export default async function ReportViewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data, error } = await supabaseAdmin
    .from('monthly_reports')
    .select('id, association_code, month, report_markdown, generated_by_email, generated_at, published_at, published_audience, published_by_email')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) notFound()
  const report = data as ReportRow

  // Audience feedback (per-recipient rating + comment).
  const feedbackRows = await getFeedbackForReport(report.id)
  const audienceStat = aggregateByAudience(feedbackRows)

  const builderHref =
    `/admin/reports/monthly?month=${report.month}` +
    (report.association_code === 'ALL' ? '' : `&assoc=${report.association_code}`)

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">

      {/* Action bar — hidden when printing. */}
      <div className="print:hidden border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Link href={builderHref} className="text-sm text-gray-500 hover:text-gray-900">
            ← Report builder
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <PublishPanel
              reportId={report.id}
              associationCode={report.association_code}
              publishedAt={report.published_at}
              publishedAudience={report.published_audience}
              publishedByEmail={report.published_by_email}
            />
            <a
              href={`/api/admin/reports/monthly/${report.id}/pdf`}
              className="rounded bg-[#f26a1b] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14]"
            >
              Download PDF
            </a>
          </div>
        </div>
      </div>

      {/* Distribution + feedback band — staff metadata, hidden in print. */}
      {report.association_code !== 'ALL' && (
        <div className="print:hidden mx-auto max-w-[820px] space-y-3 px-6 pt-5">
          <SendReportPanel
            reportId={report.id}
            publishedAudience={report.published_audience}
            boardStat={audienceStat.board}
            ownersStat={audienceStat.owners}
          />
          <FeedbackPanel rows={feedbackRows} />
        </div>
      )}

      <MonthlyReportArticle report={report} showStatementPdfLink />
    </div>
  )
}
