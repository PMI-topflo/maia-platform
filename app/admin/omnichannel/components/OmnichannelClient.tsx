'use client'

import { useState, useMemo, type ChangeEvent } from 'react'

export type ConvItem = {
  id: string
  type: 'conversation' | 'ticket' | 'email'
  channel: string
  association_code: string | null
  persona: string | null
  contact_name: string | null
  contact_email: string | null
  subject: string | null
  summary: string | null
  status: string | null
  created_at: string
}

type Association = { association_code: string; association_name: string }
type Period = 'day' | 'week' | 'month' | 'year'

const CHANNEL_COLOR: Record<string, string> = {
  whatsapp:  '#25d366',
  sms:       '#3b82f6',
  email:     '#8b5cf6',
  'email-in':  '#8b5cf6',
  'email-out': '#a78bfa',
  web:       '#6b7280',
  ticket:    '#f26a1b',
}

const CHANNEL_LABEL: Record<string, string> = {
  'email-in':  '📥 email',
  'email-out': '📤 email',
}

function bucketKey(date: Date, period: Period): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  if (period === 'day')   return `${y}-${m}-${d}`
  if (period === 'month') return `${y}-${m}`
  if (period === 'year')  return String(y)
  // week: use ISO week number
  const jan1   = new Date(y, 0, 1)
  const week   = Math.ceil(((date.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
  return `${y}-W${String(week).padStart(2, '0')}`
}

function shortLabel(key: string, period: Period): string {
  if (period === 'day')   return key.slice(5)    // MM-DD
  if (period === 'month') return key.slice(5)    // MM
  if (period === 'week')  return key.slice(5)    // Www
  return key                                      // YYYY
}

function groupByPeriod(items: ConvItem[], period: Period): Array<{ key: string; label: string; count: number }> {
  const map = new Map<string, number>()
  for (const item of items) {
    const key = bucketKey(new Date(item.created_at), period)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ key, label: shortLabel(key, period), count }))
}

function limitPeriods(data: ReturnType<typeof groupByPeriod>, period: Period) {
  const limits: Record<Period, number> = { day: 30, week: 12, month: 12, year: 10 }
  return data.slice(-limits[period])
}

export default function OmnichannelClient({
  items,
  associations,
}: {
  items: ConvItem[]
  associations: Association[]
}) {
  const [assocFilter, setAssocFilter]   = useState('')
  const [personaFilter, setPersonaFilter] = useState('')
  const [nameSearch, setNameSearch]     = useState('')
  const [period, setPeriod]             = useState<Period>('day')

  const personas = useMemo(
    () => [...new Set(items.map(i => i.persona).filter(Boolean))] as string[],
    [items]
  )

  // Build dropdown from codes that actually appear in the data.
  // Look up display names from the associations table; fall back to the raw code.
  const activeAssociations = useMemo(() => {
    const nameMap = new Map(associations.map(a => [a.association_code, a.association_name || a.association_code]))
    const countMap = new Map<string, number>()
    for (const item of items) {
      if (item.association_code) {
        countMap.set(item.association_code, (countMap.get(item.association_code) ?? 0) + 1)
      }
    }
    return [...countMap.entries()]
      .sort(([a], [b]) => (nameMap.get(a) ?? a).localeCompare(nameMap.get(b) ?? b))
      .map(([code, count]) => ({
        association_code: code,
        association_name: nameMap.get(code) ?? code,
        count,
      }))
  }, [items, associations])

  const filtered = useMemo(() => {
    const needle = nameSearch.toLowerCase().trim()
    return items.filter(item => {
      if (assocFilter   && item.association_code !== assocFilter)   return false
      if (personaFilter && item.persona          !== personaFilter) return false
      if (needle) {
        const haystack = [item.contact_name, item.contact_email, item.subject]
          .filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [items, assocFilter, personaFilter, nameSearch])

  const chartData = useMemo(
    () => limitPeriods(groupByPeriod(filtered, period), period),
    [filtered, period]
  )

  const maxCount = Math.max(...chartData.map((d: { count: number }) => d.count), 1)

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <select
          value={assocFilter}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setAssocFilter(e.target.value)}
          className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-gray-400"
        >
          <option value="">All Associations ({items.length})</option>
          {activeAssociations.map((a: { association_code: string; association_name: string; count: number }) => (
            <option key={a.association_code} value={a.association_code}>
              {a.association_name} ({a.count})
            </option>
          ))}
        </select>

        <select
          value={personaFilter}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonaFilter(e.target.value)}
          className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-gray-400"
        >
          <option value="">All Personas</option>
          {personas.map((p: string) => <option key={p} value={p}>{p}</option>)}
        </select>

        <input
          type="search"
          value={nameSearch}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNameSearch(e.target.value)}
          placeholder="Search name or email…"
          className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-gray-400 min-w-48"
        />

        <div className="ml-auto flex gap-1">
          {(['day', 'week', 'month', 'year'] as Period[]).map((p: Period) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={[
                'px-3 py-1.5 text-[0.6rem] rounded [font-family:var(--font-mono)] uppercase tracking-[0.08em] transition-colors',
                period === p
                  ? 'bg-[#0d2340] text-white'
                  : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50',
              ].join(' ')}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">Interactions over time</span>
          <span className="text-xs text-gray-400">{filtered.length} total interactions</span>
        </div>
        {chartData.length === 0 ? (
          <div className="h-28 flex items-center justify-center text-gray-400 text-sm">
            No data for selected filters
          </div>
        ) : (
          <div className="flex items-end gap-px h-28 pb-5 relative">
            {chartData.map((d: { key: string; label: string; count: number }) => {
              const pct = Math.max(2, Math.round((d.count / maxCount) * 88))
              return (
                <div key={d.key} className="flex-1 flex flex-col justify-end items-center group relative">
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 pointer-events-none">
                    {d.key}: {d.count}
                  </div>
                  <div
                    style={{ height: `${pct}px`, backgroundColor: '#f26a1b' }}
                    className="w-full rounded-t-sm opacity-75 hover:opacity-100 transition-opacity cursor-default"
                  />
                  {chartData.length <= 14 && (
                    <span className="absolute bottom-0 text-[7px] text-gray-400 font-mono mt-1">
                      {d.label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Channel legend */}
        <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-50">
          {Object.entries(CHANNEL_COLOR)
            .filter(([ch]) => !ch.includes('-') || ch === 'email-in' || ch === 'email-out')
            .map(([ch, color]) => (
              <span key={ch} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                {CHANNEL_LABEL[ch] ?? ch}
              </span>
            ))}
        </div>
      </div>

      {/* Unified conversation list */}
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
            No conversations match the selected filters
          </div>
        )}

        {filtered.slice(0, 150).map((item: ConvItem) => {
          const color = CHANNEL_COLOR[item.channel] ?? '#6b7280'
          const statusCls =
            item.status === 'open'         ? 'bg-blue-100 text-blue-600' :
            item.status === 'resolved'     ? 'bg-green-100 text-green-600' :
            item.status === 'unidentified' ? 'bg-red-100 text-red-600' :
            item.status === 'completed'    ? 'bg-gray-100 text-gray-500' :
            'bg-gray-100 text-gray-400'

          return (
            <div key={item.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-start gap-3">
              <div
                className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">
                    {item.contact_name || item.contact_email || 'Unknown'}
                  </span>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                    style={{ backgroundColor: color + '20', color }}
                  >
                    {CHANNEL_LABEL[item.channel] ?? item.channel}
                  </span>
                  {item.persona && (
                    <span className="text-[9px] text-gray-400 uppercase tracking-wide">{item.persona}</span>
                  )}
                  {item.association_code && (
                    <span className="text-[9px] text-gray-400 font-mono">{item.association_code}</span>
                  )}
                  {item.status && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-semibold ml-auto ${statusCls}`}>
                      {item.status}
                    </span>
                  )}
                </div>
                {item.subject && (
                  <p className="text-xs text-gray-600 mt-0.5 truncate">{item.subject}</p>
                )}
                {item.summary && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{item.summary}</p>
                )}
                <span className="text-[9px] text-gray-300 mt-1 block">
                  {new Date(item.created_at).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          )
        })}

        {filtered.length > 150 && (
          <p className="text-center text-xs text-gray-400 py-3">
            Showing 150 of {filtered.length} — filter by association or persona to narrow results
          </p>
        )}
      </div>
    </div>
  )
}
