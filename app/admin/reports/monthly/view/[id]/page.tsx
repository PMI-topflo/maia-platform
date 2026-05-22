// =====================================================================
// /admin/reports/monthly/view/[id]
//
// Newsletter-style HTML view of a saved monthly management report — a
// branded, print-friendly document with a stable URL that staff can
// share or print / save as PDF for the board. Staff-only (under /admin).
// =====================================================================

import { notFound } from 'next/navigation'
import Link from 'next/link'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { gatherMonthlyReportData, monthLabel } from '@/lib/monthly-report'
import { renderNewsletterMarkdown } from '@/lib/render-report-markdown'
import { listAttachmentsForTickets } from '@/lib/work-order-attachments'
import { getFinancials } from '@/lib/report-financials'
import { FinancialSummarySection } from '@/lib/render-report-financials'

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

// Print rules: force background colours / the navy hero to render in the
// PDF, and keep sections, headings and photos from being cut across page
// breaks (the default browser print behaviour ignores both).
const PRINT_CSS = `
.report-article, .report-article * {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@media print {
  @page { margin: 14mm; }
  html, body { background: #ffffff !important; }
  .report-article { box-shadow: none !important; border-radius: 0 !important; }
  .report-section, .report-block, .report-gallery, .report-footer { break-inside: avoid; }
  .report-heading { break-after: avoid; }
  .report-line { break-inside: avoid; }
  .report-gallery img { break-inside: avoid; }
}
`

function StatCard({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-[#f8f9fb] px-3 py-3 text-center">
      <div className="text-[22px] font-bold text-[#1f2a44]">{n}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  )
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

  // Activity numbers + the month's items, for the stat strip and the
  // work-order photo gallery. (The narrative itself is the saved markdown.)
  const reportData = await gatherMonthlyReportData(code === 'ALL' ? '' : code, report.month)
  const woItemIds  = reportData.reportItems
    .filter(i => i.type === 'work_order' && !i.excluded)
    .map(i => i.id)
  const photos = await listAttachmentsForTickets(woItemIds, 9)

  // Financial statement for this association + month (per-association only).
  const financials = code !== 'ALL' ? await getFinancials(code, report.month) : null
  const financialsPdfHref = financials
    ? `/api/admin/reports/monthly/financials/pdf?assoc=${encodeURIComponent(code)}&month=${encodeURIComponent(report.month)}`
    : null

  const builderHref =
    `/admin/reports/monthly?month=${report.month}` +
    (code === 'ALL' ? '' : `&assoc=${code}`)
  const t = reportData.totals

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* Action bar — hidden when printing. */}
      <div className="print:hidden bg-white border-b border-gray-200">
        <div className="mx-auto flex max-w-[820px] items-center justify-between px-6 py-3">
          <Link href={builderHref} className="text-sm text-gray-500 hover:text-gray-900">
            ← Report builder
          </Link>
          <a
            href={`/api/admin/reports/monthly/${report.id}/pdf`}
            className="rounded bg-[#f26a1b] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14]"
          >
            Download PDF
          </a>
        </div>
      </div>

      <main className="mx-auto max-w-[820px] px-6 py-8 print:p-0">
        <article className="report-article overflow-hidden rounded-xl bg-white shadow-sm print:rounded-none print:shadow-none">

          {/* Hero banner */}
          <div className="report-hero bg-gradient-to-br from-[#1f2a44] to-[#0f1626] px-9 py-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pmi-logo-white.png" alt="PMI Top Florida Properties" className="h-11 w-auto" />
            <h1 className="mt-4 text-[30px] font-bold leading-tight text-white">
              Monthly Management Report
            </h1>
            <div className="mt-1 text-[15px] text-[#d7dbe4]">
              {scopeLabel} · {monthLabel(report.month)}
            </div>
          </div>

          <div className="px-9 pb-2 pt-7">
            {/* The month at a glance */}
            <div className="report-block grid grid-cols-5 gap-2.5">
              <StatCard n={t.ticketsReceived}      label="Tickets received" />
              <StatCard n={t.ticketsClosed}        label="Tickets closed" />
              <StatCard n={t.workOrdersReceived}   label="Work orders" />
              <StatCard n={t.workOrdersClosed}     label="WOs completed" />
              <StatCard n={t.emailThreadsReceived} label="Email threads" />
            </div>

            {/* Financial summary — figures from the uploaded CINC statement */}
            {financials?.figures && (
              <FinancialSummarySection figures={financials.figures} pdfHref={financialsPdfHref} />
            )}

            {/* The MAIA narrative, rendered as numbered newsletter sections */}
            <div className="mt-2">
              {renderNewsletterMarkdown(report.report_markdown)}
            </div>

            {/* Work-order photo gallery */}
            {photos.length > 0 && (
              <div className="report-block mt-7">
                <h2 className="report-heading mb-2.5 flex items-center gap-2 border-b-2 border-[#f26a1b] pb-1.5">
                  <span className="text-base font-semibold text-[#1f2a44]">Work Order Photos</span>
                </h2>
                <div className="report-gallery grid grid-cols-3 gap-2.5">
                  {photos.map(p => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={p.id}
                      src={p.signed_url}
                      alt={p.filename}
                      className="h-32 w-full rounded-md border border-gray-200 object-cover"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <footer className="report-footer mt-7 border-t border-gray-200 bg-[#fafbfc] px-9 py-4 text-[11px] text-gray-400">
            Generated by <b className="text-[#1f2a44]">MAIA</b> ·
            {' '}{new Date(report.generated_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
            {report.generated_by_email ? ` by ${report.generated_by_email}` : ''}
            {' '}· PMI Top Florida Properties
          </footer>
        </article>
      </main>
    </div>
  )
}
