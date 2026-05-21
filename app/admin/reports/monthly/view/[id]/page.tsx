// =====================================================================
// /admin/reports/monthly/view/[id]
//
// Standalone HTML view of a saved monthly management report — a clean,
// print-friendly document with a stable URL that staff can share or
// print / save as PDF for the board. Staff-only (under /admin).
// =====================================================================

import { notFound } from 'next/navigation'
import Link from 'next/link'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { monthLabel } from '@/lib/monthly-report'
import { renderReportMarkdown } from '@/lib/render-report-markdown'
import PrintButton from './PrintButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Monthly Report — PMI Top Florida' }

interface ReportRow {
  id:                 string
  association_code:   string
  month:              string
  report_markdown:    string
  generated_by_email: string | null
  generated_at:       string
}

export default async function ReportViewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data, error } = await supabaseAdmin
    .from('monthly_reports')
    .select('id, association_code, month, report_markdown, generated_by_email, generated_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) notFound()
  const report = data as ReportRow

  const code = report.association_code
  let assocName: string | null = null
  if (code && code !== 'ALL') {
    const { data: a } = await supabaseAdmin
      .from('associations')
      .select('association_name')
      .eq('association_code', code)
      .maybeSingle()
    assocName = (a?.association_name as string | undefined) ?? null
  }
  const scopeLabel = code === 'ALL'
    ? 'All Associations'
    : (assocName ? `${assocName} (${code})` : code)

  const builderHref =
    `/admin/reports/monthly?month=${report.month}` +
    (code === 'ALL' ? '' : `&assoc=${code}`)

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Action bar — hidden when printing. */}
      <div className="print:hidden bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href={builderHref} className="text-sm text-gray-500 hover:text-gray-900">
            ← Report builder
          </Link>
          <PrintButton />
        </div>
      </div>

      {/* The report document. */}
      <main className="max-w-3xl mx-auto px-6 py-8 print:p-0">
        <article className="bg-white rounded-lg border border-gray-200 px-10 py-10 print:border-0 print:rounded-none print:px-0 print:py-0">
          <header className="border-b-2 border-[#f26a1b] pb-4 mb-6">
            <div className="text-[#f26a1b] font-bold text-xs tracking-[0.12em] uppercase">
              PMI Top Florida Properties
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">Monthly Management Report</h1>
            <div className="text-gray-600 text-sm mt-1">
              {scopeLabel} · {monthLabel(report.month)}
            </div>
          </header>

          <div className="report-body">
            {renderReportMarkdown(report.report_markdown)}
          </div>

          <footer className="border-t border-gray-200 mt-10 pt-3 text-xs text-gray-400">
            Generated {new Date(report.generated_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
            {report.generated_by_email ? ` by ${report.generated_by_email}` : ''}
            {' '}· MAIA · PMI Top Florida Properties
          </footer>
        </article>
      </main>
    </div>
  )
}
