// =====================================================================
// /admin/reports/monthly
//
// Monthly management report. Shows the month's activity (tickets and
// work orders received vs closed, email threads received) per
// association, a preview of every ticket / work order created that
// month — all included by default, untick to leave one out — and a
// one-click MAIA-generated board report. Filter by association + month.
// =====================================================================

import Link from 'next/link'

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { gatherMonthlyReportData, currentMonth, monthLabel } from '@/lib/monthly-report'
import MonthlyReportGenerator from './MonthlyReportGenerator'
import ReportItemsPreview from './ReportItemsPreview'
import BoardMessagePanel from './BoardMessagePanel'
import FinancialPanel from './FinancialPanel'
import { getFinancials } from '@/lib/report-financials'

export const metadata = { title: 'Monthly Management Report — PMI Top Florida' }
export const dynamic = 'force-dynamic'

/** The last 12 calendar months as { value: 'YYYY-MM', label: 'Month YYYY' }. */
function recentMonths(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    })
  }
  return out
}

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ assoc?: string; month?: string }>
}) {
  const sp    = await searchParams
  const assoc = (sp.assoc ?? '').trim().toUpperCase()
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : currentMonth()

  const data = await gatherMonthlyReportData(assoc, month)

  const { data: assocRows } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .order('association_name', { ascending: true })
  const assocOptions = ((assocRows ?? []) as Array<{ association_code: string; association_name: string }>)
    .filter(a => a.association_code)
  const assocNames: Record<string, string> = {}
  for (const a of assocOptions) assocNames[a.association_code] = a.association_name

  // Board-message status for the selected association + month.
  let boardStatus: { submitted: boolean; authorName: string | null; message: string | null } | null = null
  if (assoc) {
    const { data: bm } = await supabaseAdmin
      .from('board_messages')
      .select('message, author_name, submitted_at')
      .eq('association_code', assoc)
      .eq('month', month)
      .maybeSingle()
    if (bm) {
      boardStatus = {
        submitted:  !!bm.submitted_at,
        authorName: (bm.author_name as string | null) ?? null,
        message:    (bm.message as string | null) ?? null,
      }
    }
  }

  // Financial statement on file for the selected association + month.
  const financials = assoc ? await getFinancials(assoc, month) : null

  const t = data.totals

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-gray-900">Monthly Management Report</h1>
          <p className="text-sm text-gray-500 mt-1">
            Activity for {monthLabel(month)}, every ticket and work order from the month
            (untick what to leave out), and a one-click board report MAIA writes from it.
          </p>
        </div>

        {/* Filters — plain GET form, no client JS. */}
        <form method="get" className="flex flex-wrap items-end gap-3 mb-6">
          <label className="text-xs text-gray-600">
            <span className="block mb-1 font-medium uppercase tracking-wide">Association</span>
            <select name="assoc" defaultValue={assoc} className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[220px]">
              <option value="">All associations</option>
              {assocOptions.map(a => (
                <option key={a.association_code} value={a.association_code}>
                  {a.association_name} ({a.association_code})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1 font-medium uppercase tracking-wide">Month</span>
            <select name="month" defaultValue={month} className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[160px]">
              {recentMonths().map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="bg-[#f26a1b] text-white text-sm font-medium px-4 py-1.5 rounded hover:bg-[#d85a14]">
            Apply
          </button>
          {assoc && (
            <Link href={`/admin/reports/monthly?month=${month}`} className="text-sm text-gray-500 hover:text-gray-800 pb-1.5">
              Clear association
            </Link>
          )}
        </form>

        {/* ── Activity ────────────────────────────────────────────── */}
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Activity — {monthLabel(month)}</h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-semibold">Association</th>
                <th className="px-4 py-2 font-semibold text-right">Tickets received</th>
                <th className="px-4 py-2 font-semibold text-right">Tickets closed</th>
                <th className="px-4 py-2 font-semibold text-right">WOs received</th>
                <th className="px-4 py-2 font-semibold text-right">WOs closed</th>
                <th className="px-4 py-2 font-semibold text-right">Email threads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.activity.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No activity recorded this month.</td></tr>
              ) : data.activity.map(a => (
                <tr key={a.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-800">
                    {a.name}{a.name !== a.code && <span className="text-gray-400"> · {a.code}</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-700">{a.ticketsReceived}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{a.ticketsClosed}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{a.workOrdersReceived}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{a.workOrdersClosed}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{a.emailThreadsReceived}</td>
                </tr>
              ))}
            </tbody>
            {data.activity.length > 0 && (
              <tfoot className="bg-gray-50 border-t border-gray-100 font-semibold text-gray-900">
                <tr>
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">{t.ticketsReceived}</td>
                  <td className="px-4 py-2 text-right">{t.ticketsClosed}</td>
                  <td className="px-4 py-2 text-right">{t.workOrdersReceived}</td>
                  <td className="px-4 py-2 text-right">{t.workOrdersClosed}</td>
                  <td className="px-4 py-2 text-right">{t.emailThreadsReceived}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ── Report items (opt-out preview) ──────────────────────── */}
        <h2 className="text-sm font-semibold text-gray-900 mb-2">
          In the report ({data.reportItems.length} item{data.reportItems.length === 1 ? '' : 's'})
        </h2>
        <ReportItemsPreview items={data.reportItems} assocNames={assocNames} />

        {/* ── Message from the Board (optional pre-generation step) ── */}
        <BoardMessagePanel assoc={assoc} month={month} status={boardStatus} />

        {/* ── Financial statement (optional pre-generation step) ───── */}
        <FinancialPanel
          assoc={assoc}
          month={month}
          existing={financials ? {
            figures:        financials.figures,
            pdf_filename:   financials.pdf_filename,
            extract_status: financials.extract_status,
            extract_error:  financials.extract_error,
          } : null}
        />

        {/* ── AI board report ─────────────────────────────────────── */}
        <MonthlyReportGenerator assoc={assoc} month={month} monthLabel={monthLabel(month)} />
      </main>
    </div>
  )
}
