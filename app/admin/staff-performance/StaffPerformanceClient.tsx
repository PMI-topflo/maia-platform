// =====================================================================
// app/admin/staff-performance/StaffPerformanceClient.tsx
//
// Client component — renders the chart, table, and the
// range / type filter chips. Sort state is local; range + type
// are URL-driven so views are linkable.
// =====================================================================

'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { fmtDuration, type StaffPerformanceRow } from '@/lib/staff-performance'

type RangeKey = '7d' | '30d' | '90d' | 'all'
type TypeKey  = 'all' | 'ticket' | 'work_order'

interface Props {
  rows:                 StaffPerformanceRow[]
  activeRange:          RangeKey
  activeType:           TypeKey
  totalTicketsTouched:  number
  totalEvents:          number
}

type SortKey = 'name' | 'resolved_count' | 'avg_first_response_ms' | 'avg_time_to_close_ms'

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '7d',  label: 'Last 7 days'  },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'all', label: 'All time'     },
]

const TYPE_OPTIONS: Array<{ key: TypeKey; label: string }> = [
  { key: 'all',        label: 'Both'        },
  { key: 'ticket',     label: 'Tickets'     },
  { key: 'work_order', label: 'Work orders' },
]

export default function StaffPerformanceClient(props: Props) {
  const router    = useRouter()
  const pathname  = usePathname()
  const [pending, startTransition] = useTransition()

  const [sortKey, setSortKey] = useState<SortKey>('resolved_count')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function setRange(next: RangeKey) {
    const params = new URLSearchParams()
    if (next !== '30d')           params.set('range', next)
    if (props.activeType !== 'all') params.set('type',  props.activeType)
    startTransition(() => router.replace(params.toString() ? `${pathname}?${params}` : pathname))
  }

  function setType(next: TypeKey) {
    const params = new URLSearchParams()
    if (props.activeRange !== '30d') params.set('range', props.activeRange)
    if (next !== 'all')              params.set('type',  next)
    startTransition(() => router.replace(params.toString() ? `${pathname}?${params}` : pathname))
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      // Reasonable defaults: text asc, numbers desc.
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const sortedRows = useMemo(() => {
    const copy = [...props.rows]
    copy.sort((a, b) => {
      const av = a[sortKey] as string | number | null
      const bv = b[sortKey] as string | number | null
      // Push nulls to the bottom regardless of sort direction.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      const na = Number(av)
      const nb = Number(bv)
      return sortDir === 'asc' ? na - nb : nb - na
    })
    return copy
  }, [props.rows, sortKey, sortDir])

  const chartData = useMemo(() => {
    return [...props.rows]
      .filter(r => r.resolved_count > 0)
      .sort((a, b) => b.resolved_count - a.resolved_count)
      .slice(0, 12)
      .map(r => ({
        name:     r.name || r.email,
        resolved: r.resolved_count,
      }))
  }, [props.rows])

  const totals = useMemo(() => ({
    resolved:    props.rows.reduce((s, r) => s + r.resolved_count, 0),
    activeStaff: props.rows.filter(r => r.resolved_count > 0 || r.first_response_sample_size > 0).length,
  }), [props.rows])

  return (
    <div className={pending ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Staff performance</h1>
        <div className="text-xs text-gray-500">
          {totals.activeStaff} active · {totals.resolved} resolved · {props.totalTicketsTouched} tickets touched · {props.totalEvents} events
        </div>
      </div>

      {/* Range + type chips */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wide text-gray-400 mr-1">Range</span>
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setRange(opt.key)}
            className={[
              'px-3 py-1 rounded-full text-xs border transition-colors',
              opt.key === props.activeRange
                ? 'bg-[#f26a1b] text-white border-[#f26a1b]'
                : 'bg-white text-gray-700 border-gray-300 hover:border-[#f26a1b]',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}

        <span className="text-xs uppercase tracking-wide text-gray-400 mx-2">Type</span>
        {TYPE_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setType(opt.key)}
            className={[
              'px-3 py-1 rounded-full text-xs border transition-colors',
              opt.key === props.activeType
                ? 'bg-slate-700 text-white border-slate-700'
                : 'bg-white text-gray-700 border-gray-300 hover:border-slate-500',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Bar chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Tickets resolved per staff (top 12)</h2>
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-gray-400">
            No resolutions in this range.
          </div>
        ) : (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="name"
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  tick={{ fontSize: 11, fill: '#666' }}
                  height={50}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#666' }} />
                <Tooltip
                  cursor={{ fill: 'rgba(242,106,27,0.08)' }}
                  contentStyle={{ fontSize: '12px', borderRadius: 4 }}
                />
                <Bar dataKey="resolved" fill="#f26a1b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <SortableTh label="Staff"             k="name"                  cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableTh label="Resolved/closed"   k="resolved_count"        cur={sortKey} dir={sortDir} onClick={toggleSort} numeric />
              <SortableTh label="Avg first response" k="avg_first_response_ms" cur={sortKey} dir={sortDir} onClick={toggleSort} numeric />
              <SortableTh label="Avg time to close"  k="avg_time_to_close_ms"  cur={sortKey} dir={sortDir} onClick={toggleSort} numeric />
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-400">No staff data in range.</td></tr>
            )}
            {sortedRows.map(r => (
              <tr key={r.email} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5 align-top">
                  <div className="font-medium text-gray-900">{r.name || r.email}</div>
                  <div className="text-xs text-gray-500">{r.email}{r.role ? ` · ${r.role}` : ''}</div>
                </td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{r.resolved_count}</td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">
                  {fmtDuration(r.avg_first_response_ms)}
                  {r.first_response_sample_size > 0 && (
                    <span className="ml-1 text-[10px] text-gray-400">n={r.first_response_sample_size}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">
                  {fmtDuration(r.avg_time_to_close_ms)}
                  {r.close_sample_size > 0 && (
                    <span className="ml-1 text-[10px] text-gray-400">n={r.close_sample_size}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-400">
        Data source: <span className="font-mono">ticket_events</span>. Metrics attribute first-response and first-resolve to the staff member who acted first within the selected range.
      </div>
    </div>
  )
}

function SortableTh(props: {
  label:    string
  k:        SortKey
  cur:      SortKey
  dir:      'asc' | 'desc'
  onClick:  (k: SortKey) => void
  numeric?: boolean
}) {
  const active = props.cur === props.k
  const arrow  = active ? (props.dir === 'asc' ? '↑' : '↓') : ''
  return (
    <th
      onClick={() => props.onClick(props.k)}
      className={[
        'px-3 py-2 cursor-pointer select-none hover:text-gray-700',
        props.numeric ? 'text-right' : 'text-left',
        active ? 'text-[#f26a1b]' : '',
      ].join(' ')}
    >
      {props.label} <span className="ml-1 text-[10px]">{arrow}</span>
    </th>
  )
}
