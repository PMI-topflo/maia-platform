'use client'

// =====================================================================
// ComplianceMatrix.tsx — the association compliance matrix (hub
// "Documents & Compliance" tab). Every catalog item gets an Applies
// toggle + status + expiry; categories collapse with a live score, and
// an overall % sits up top. Saves to compliance_records.
// =====================================================================

import { useEffect, useState } from 'react'
import {
  categoriesForScope, scoreFor, STATUS_LABEL, STATUS_STYLE, SETTABLE_STATUSES,
  type ComplianceStatus, type ComplianceRecord,
} from '@/lib/compliance-taxonomy'

interface Val { applicable: boolean; status: ComplianceStatus; expiry_date: string | null }
const DEFAULT: Val = { applicable: true, status: 'missing', expiry_date: null }
const scoreColor = (pct: number | null) =>
  pct == null ? 'bg-gray-100 text-gray-500' : pct >= 90 ? 'bg-emerald-100 text-emerald-800' : pct >= 60 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'

export default function ComplianceMatrix({ assocCode }: { assocCode: string }) {
  const cats = categoriesForScope('association')
  const [vals, setVals] = useState<Map<string, Val>>(new Map())
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/compliance?assoc=${encodeURIComponent(assocCode)}&scope=association`)
      .then(r => r.json())
      .then((d: { records?: ComplianceRecord[] }) => {
        if (!live) return
        const m = new Map<string, Val>()
        for (const r of d.records ?? []) m.set(r.item_key, { applicable: r.applicable, status: r.status, expiry_date: r.expiry_date })
        setVals(m)
      })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [assocCode])

  const get = (key: string): Val => vals.get(key) ?? DEFAULT
  function set(key: string, patch: Partial<Val>) {
    setVals(prev => { const m = new Map(prev); m.set(key, { ...get(key), ...patch }); return m })
    setMsg(null)
  }
  function toggleCat(key: string) {
    setOpen(prev => { const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s })
  }

  // overall score across every association item
  const allItems = cats.flatMap(c => c.items)
  const recMap = new Map<string, ComplianceRecord>()
  for (const i of allItems) { const v = get(i.key); recMap.set(i.key, { item_key: i.key, applicable: v.applicable, status: v.status, expiry_date: v.expiry_date, notes: null }) }
  const overall = scoreFor(allItems, recMap)

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const records = allItems.map(i => { const v = get(i.key); return { item_key: i.key, applicable: v.applicable, status: v.status, expiry_date: v.expiry_date } })
      const res = await fetch('/api/admin/compliance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ association_code: assocCode, scope: 'association', records }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setMsg('Compliance saved.')
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading compliance…</p>

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">Association compliance</span>
          <span className={`rounded px-2 py-0.5 text-sm font-semibold ${scoreColor(overall.pct)}`}>{overall.pct == null ? '—' : `${overall.pct}%`}</span>
          <span className="text-xs text-gray-500">{overall.current}/{overall.applicable} current</span>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-xs text-emerald-700">{msg}</span>}
          <button onClick={save} disabled={saving} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>

      <div className="space-y-2">
        {cats.map(cat => {
          const sc = scoreFor(cat.items, recMap)
          const isOpen = open.has(cat.key)
          return (
            <div key={cat.key} className="rounded-lg border border-gray-200 bg-white">
              <button onClick={() => toggleCat(cat.key)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                <span className="flex items-center gap-3">
                  <span className="text-gray-400">{isOpen ? '▾' : '▸'}</span>
                  <span className="text-sm font-semibold text-gray-900">{cat.label}</span>
                  <span className="text-[11px] text-gray-400">{cat.items.length} items</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500">{sc.current}/{sc.applicable}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${scoreColor(sc.pct)}`}>{sc.pct == null ? 'N/A' : `${sc.pct}%`}</span>
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-gray-100 px-4 py-2">
                  <table className="w-full text-sm">
                    <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400">
                      <th className="py-1 text-left font-semibold">Item</th><th className="py-1 text-left font-semibold">Applies</th>
                      <th className="py-1 text-left font-semibold">Status</th><th className="py-1 text-left font-semibold">Expiry</th>
                    </tr></thead>
                    <tbody>
                      {cat.items.map(item => {
                        const v = get(item.key)
                        return (
                          <tr key={item.key} className="border-t border-gray-50">
                            <td className="py-1.5 text-gray-900">{item.label}</td>
                            <td className="py-1.5">
                              <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                                <input type="checkbox" checked={v.applicable} onChange={e => set(item.key, { applicable: e.target.checked })} />
                                {v.applicable ? 'Applies' : 'N/A'}
                              </label>
                            </td>
                            <td className="py-1.5">
                              {v.applicable ? (
                                <select value={v.status === 'na' ? 'missing' : v.status} onChange={e => set(item.key, { status: e.target.value as ComplianceStatus })}
                                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[v.status === 'na' ? 'missing' : v.status]}`}>
                                  {SETTABLE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                                </select>
                              ) : <span className="text-[11px] text-gray-400">—</span>}
                            </td>
                            <td className="py-1.5">
                              {v.applicable && item.expiry
                                ? <input type="date" value={v.expiry_date ?? ''} onChange={e => set(item.key, { expiry_date: e.target.value || null })} className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px]" />
                                : <span className="text-[11px] text-gray-300">—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
