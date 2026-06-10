// =====================================================================
// /admin/recurring-services/coverage — the click-through from the
// "Recurring Work Orders" dashboard tile. Shows this week's reporting
// health plus every active recurring service's latest visit and whether
// it was documented (photos / report).
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getWeeklyCoverage, listLatestVisitPerService, type CoverageRow, type CoverageState } from '@/lib/service-visits'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Recurring coverage — PMI Top Florida' }

const STATE_BADGE: Record<CoverageState, { label: string; cls: string; dot: string }> = {
  complete: { label: 'Reported',  cls: 'bg-emerald-100 text-emerald-800', dot: '#22c55e' },
  not_due:  { label: 'Not due',   cls: 'bg-slate-100 text-slate-600',     dot: '#94a3b8' },
  late:     { label: 'Late',      cls: 'bg-amber-100 text-amber-800',     dot: '#f59e0b' },
  missed:   { label: 'Missed',    cls: 'bg-red-100 text-red-800',         dot: '#ef4444' },
  none:     { label: 'No visits', cls: 'bg-gray-100 text-gray-500',       dot: '#cbd5e1' },
}

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function YesNo({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${ok ? 'text-emerald-700' : 'text-gray-400'}`}>
      <span aria-hidden>{ok ? '✓' : '—'}</span>{label}
    </span>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default async function CoveragePage() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const [weekly, latest] = await Promise.all([getWeeklyCoverage(), listLatestVisitPerService()])

  const summary = weekly.sev === 'warning'
    ? { text: `${weekly.missed} missed${weekly.late ? ` · ${weekly.late} late` : ''}`, cls: 'text-red-600' }
    : weekly.sev === 'caution'
      ? { text: `${weekly.late} late this week`, cls: 'text-amber-600' }
      : { text: weekly.total ? 'All weekly services reported' : 'No weekly services configured', cls: 'text-emerald-600' }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="RECURRING COVERAGE"><AdminNav /></SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        {/* ── This-week summary ── */}
        <section className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Recurring Work Orders — weekly reporting</h1>
              <p className="text-sm text-gray-500 mt-0.5">Week of {fmtDate(weekly.week_of)} · {weekly.total} weekly service{weekly.total === 1 ? '' : 's'}</p>
            </div>
            <div className={`text-sm font-semibold ${summary.cls}`}>{summary.text}</div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Reported" value={weekly.complete} tone="emerald" />
            <Stat label="Late" value={weekly.late} tone="amber" />
            <Stat label="Missed" value={weekly.missed} tone="red" />
            <Stat label="Weekly services" value={weekly.total} tone="slate" />
          </div>
        </section>

        {/* ── Full per-service table ── */}
        <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700 [font-family:var(--font-mono)]">Every recurring service · latest visit</h2>
            <Link href="/admin/recurring-services" className="text-xs font-mono text-gray-400 hover:text-gray-700 uppercase tracking-wide">Manage services →</Link>
          </div>
          {latest.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">No active recurring services. Set them up under <Link href="/admin/recurring-services" className="text-[#f26a1b] hover:underline">Recurring services</Link>.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-mono uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Association</th>
                    <th className="px-4 py-2 font-medium">Vendor</th>
                    <th className="px-4 py-2 font-medium">Service</th>
                    <th className="px-4 py-2 font-medium">Expected</th>
                    <th className="px-4 py-2 font-medium">Latest visit</th>
                    <th className="px-4 py-2 font-medium">Documentation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {latest.map(row => <CoverageRowLine key={row.service_id} row={row} />)}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'red' | 'slate' }) {
  const cls: Record<string, string> = {
    emerald: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-700', slate: 'text-slate-700',
  }
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
      <div className={`text-2xl font-bold tabular-nums leading-none ${cls[tone]}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function CoverageRowLine({ row }: { row: CoverageRow }) {
  const badge = STATE_BADGE[row.state]
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2.5 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: badge.dot }} aria-hidden />
          <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${badge.cls}`}>{badge.label}</span>
        </span>
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap">
        <Link href={`/admin/recurring-services?assoc=${row.association_code}`} className="hover:text-[#f26a1b]">{row.association_code}</Link>
      </td>
      <td className="px-4 py-2.5 text-gray-800 truncate max-w-[180px]">{row.vendor_name ?? '—'}</td>
      <td className="px-4 py-2.5 text-gray-600">
        {row.service_type ?? '—'}
        {row.cadence && row.cadence !== 'weekly' && <span className="ml-1.5 inline-flex rounded px-1 py-0.5 text-[9px] font-mono uppercase bg-indigo-50 text-indigo-600">{row.cadence}</span>}
      </td>
      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">{row.expected_day != null ? DAY_LABEL[row.expected_day] : '—'}</td>
      <td className="px-4 py-2.5 text-gray-600 text-xs whitespace-nowrap">
        {row.ticket_id
          ? <Link href={`/admin/tickets/${row.ticket_id}`} className="hover:text-[#f26a1b]">{fmtDate(row.week_of)}{row.last_activity_at ? ` · last activity ${fmtDate(row.last_activity_at)}` : ''}</Link>
          : <span className="text-gray-400">none yet</span>}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <span className="inline-flex items-center gap-3">
          <YesNo ok={row.has_photos} label="photos" />
          <YesNo ok={row.has_report} label="report" />
        </span>
      </td>
    </tr>
  )
}
