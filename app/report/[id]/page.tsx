// =====================================================================
// /report/[id]
//
// The audience-facing view of a published monthly management report.
// Login required (any persona); access is then gated by audience and
// association match:
//   - staff:  always allowed (matches the /admin staff view).
//   - board:  report must be published to 'board' or 'both', and the
//             viewer's association must match the report's.
//   - owner:  same, audience 'owners' or 'both'.
//
// Anyone else, or without a session, lands on the home page. The
// document itself is the shared <MonthlyReportArticle>, so this view
// stays identical to the staff view.
// =====================================================================

import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { canViewPublishedReport, type ReportAudience } from '@/lib/monthly-report'
import MonthlyReportArticle from '@/components/MonthlyReportArticle'

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
}

export default async function PublishedReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session) redirect('/')

  const { data, error } = await supabaseAdmin
    .from('monthly_reports')
    .select('id, association_code, month, report_markdown, generated_by_email, generated_at, published_at, published_audience')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) notFound()
  const report = data as ReportRow

  if (!canViewPublishedReport(session, report)) notFound()

  const isStaff = session.persona === 'staff'

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Slim action bar — hidden when printing. */}
      <div className="print:hidden border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="text-sm text-gray-500">PMI Top Florida Properties</div>
          <a
            href={`/api/admin/reports/monthly/${report.id}/pdf`}
            className="rounded bg-[#f26a1b] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14]"
          >
            Download PDF
          </a>
        </div>
      </div>

      <MonthlyReportArticle report={report} showStatementPdfLink={isStaff} />
    </div>
  )
}
