// =====================================================================
// /admin/reports/monthly
//
// Monthly management report — the work orders staff flagged for
// inclusion (tickets.marked_for_monthly_report = true), grouped by
// association. Filterable by association and by month (work-order
// creation date). The flag is toggled on the work-order detail page.
// =====================================================================

import Link from 'next/link'

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const metadata = { title: 'Monthly Work Order Report — PMI Top Florida' }
export const dynamic = 'force-dynamic'

interface WorkOrderRow {
  id:               number
  ticket_number:    string
  subject:          string | null
  status:           string | null
  priority:         string | null
  association_code: string | null
  created_at:       string
}

interface WoDetail {
  ticket_id:    number
  completed_at: string | null
  cost_cents:   number | null
  vendor_name:  string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The last 12 calendar months as { value: 'YYYY-MM', label: 'Month YYYY' }. */
function recentMonths(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    out.push({ value, label })
  }
  return out
}

/** First instant of `month` (YYYY-MM) and of the month after it. */
function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start  = new Date(Date.UTC(y, m - 1, 1)).toISOString()
  const end    = new Date(Date.UTC(y, m, 1)).toISOString()
  return { start, end }
}

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ assoc?: string; month?: string }>
}) {
  const sp     = await searchParams
  const assoc  = (sp.assoc ?? '').trim().toUpperCase()
  const month  = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : ''

  // Flagged work orders, narrowed by the active filters.
  let query = supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, subject, status, priority, association_code, created_at')
    .eq('type', 'work_order')
    .eq('marked_for_monthly_report', true)
    .order('association_code', { ascending: true })
    .order('created_at', { ascending: false })
  if (assoc) query = query.eq('association_code', assoc)
  if (month) {
    const { start, end } = monthBounds(month)
    query = query.gte('created_at', start).lt('created_at', end)
  }

  // The association dropdown lists every association that has at least
  // one flagged work order — independent of the current filter.
  const [{ data: rows }, { data: allFlagged }, { data: assocRows }] = await Promise.all([
    query,
    supabaseAdmin
      .from('tickets')
      .select('association_code')
      .eq('type', 'work_order')
      .eq('marked_for_monthly_report', true),
    supabaseAdmin.from('associations').select('association_code, association_name'),
  ])

  const workOrders = (rows ?? []) as WorkOrderRow[]

  // Cost / completion / vendor come from work_order_details.
  const detailById = new Map<number, WoDetail>()
  if (workOrders.length > 0) {
    const { data: details } = await supabaseAdmin
      .from('work_order_details')
      .select('ticket_id, completed_at, cost_cents, vendor_name')
      .in('ticket_id', workOrders.map(w => w.id))
    for (const d of (details ?? []) as WoDetail[]) detailById.set(d.ticket_id, d)
  }

  const assocName = new Map<string, string>()
  for (const a of (assocRows ?? []) as Array<{ association_code: string; association_name: string }>) {
    if (a.association_code) assocName.set(a.association_code, a.association_name)
  }

  const assocOptions = Array.from(
    new Set((allFlagged ?? []).map(r => (r.association_code as string | null) ?? '').filter(Boolean)),
  ).sort()

  // Group the filtered work orders by association.
  const groups = new Map<string, WorkOrderRow[]>()
  for (const w of workOrders) {
    const key = w.association_code ?? '—'
    const list = groups.get(key)
    if (list) list.push(w)
    else      groups.set(key, [w])
  }

  const grandTotalCents = workOrders.reduce(
    (sum, w) => sum + (detailById.get(w.id)?.cost_cents ?? 0), 0,
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-gray-900">Monthly Work Order Report</h1>
          <p className="text-sm text-gray-500 mt-1">
            Work orders flagged for the management report. Tick
            &ldquo;Include in monthly management report&rdquo; on a work order to add it here.
          </p>
        </div>

        {/* Filters — plain GET form so no client JS is needed. */}
        <form method="get" className="flex flex-wrap items-end gap-3 mb-5">
          <label className="text-xs text-gray-600">
            <span className="block mb-1 font-medium uppercase tracking-wide">Association</span>
            <select
              name="assoc"
              defaultValue={assoc}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[200px]"
            >
              <option value="">All associations</option>
              {assocOptions.map(code => (
                <option key={code} value={code}>
                  {assocName.get(code) ? `${assocName.get(code)} (${code})` : code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1 font-medium uppercase tracking-wide">Month created</span>
            <select
              name="month"
              defaultValue={month}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[160px]"
            >
              <option value="">All months</option>
              {recentMonths().map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="bg-[#f26a1b] text-white text-sm font-medium px-4 py-1.5 rounded hover:bg-[#d85a14]"
          >
            Apply
          </button>
          {(assoc || month) && (
            <Link href="/admin/reports/monthly" className="text-sm text-gray-500 hover:text-gray-800 pb-1.5">
              Clear
            </Link>
          )}
        </form>

        {/* Summary line */}
        <div className="text-xs text-gray-500 mb-3">
          {workOrders.length} work order{workOrders.length === 1 ? '' : 's'}
          {' '}across {groups.size} association{groups.size === 1 ? '' : 's'}
          {grandTotalCents > 0 && <span> · total cost {fmtMoney(grandTotalCents)}</span>}
        </div>

        {workOrders.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg py-12 text-center text-sm text-gray-400">
            No work orders are flagged for the monthly report
            {(assoc || month) ? ' for this filter.' : ' yet.'}
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(groups.entries()).map(([code, list]) => {
              const subtotal = list.reduce((s, w) => s + (detailById.get(w.id)?.cost_cents ?? 0), 0)
              return (
                <section key={code} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <h2 className="text-sm font-semibold text-gray-900">
                      {assocName.get(code) ?? code}
                      {assocName.get(code) && <span className="text-gray-400 font-normal"> · {code}</span>}
                    </h2>
                    <span className="text-xs text-gray-500">
                      {list.length} WO{list.length === 1 ? '' : 's'}
                      {subtotal > 0 && <span> · {fmtMoney(subtotal)}</span>}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-gray-100">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-2 font-semibold">Work Order</th>
                        <th className="px-4 py-2 font-semibold">Subject</th>
                        <th className="px-4 py-2 font-semibold">Vendor</th>
                        <th className="px-4 py-2 font-semibold">Status</th>
                        <th className="px-4 py-2 font-semibold whitespace-nowrap">Created</th>
                        <th className="px-4 py-2 font-semibold whitespace-nowrap">Completed</th>
                        <th className="px-4 py-2 font-semibold text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {list.map(w => {
                        const d = detailById.get(w.id)
                        return (
                          <tr key={w.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 whitespace-nowrap">
                              <Link href={`/admin/tickets/${w.id}`} className="font-mono text-[#f26a1b] hover:underline">
                                {w.ticket_number}
                              </Link>
                            </td>
                            <td className="px-4 py-2 text-gray-700">
                              <div className="line-clamp-1 max-w-[320px]">{w.subject ?? '—'}</div>
                            </td>
                            <td className="px-4 py-2 text-gray-600">{d?.vendor_name ?? '—'}</td>
                            <td className="px-4 py-2 text-gray-600 capitalize">{w.status ?? '—'}</td>
                            <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(w.created_at)}</td>
                            <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(d?.completed_at ?? null)}</td>
                            <td className="px-4 py-2 text-gray-700 text-right whitespace-nowrap">{fmtMoney(d?.cost_cents ?? null)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </section>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
