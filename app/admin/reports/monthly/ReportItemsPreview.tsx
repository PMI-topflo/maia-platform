'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

export interface PreviewItem {
  id:               number
  ticket_number:    string
  type:             string
  subject:          string | null
  status:           string | null
  association_code: string | null
  created_at:       string
  excluded:         boolean
}

interface Props {
  items:      PreviewItem[]
  assocNames: Record<string, string>
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The report covers every ticket / work order for the month. Each row
 *  has a checkbox — ticked = included. Unticking persists an exclusion
 *  so the generated report (and a later re-generate) leaves it out. */
export default function ReportItemsPreview({ items, assocNames }: Props) {
  // id -> excluded?
  const [excluded, setExcluded] = useState<Record<number, boolean>>(
    () => Object.fromEntries(items.map(i => [i.id, i.excluded])),
  )
  const [busy, setBusy] = useState<number | null>(null)

  async function toggle(id: number) {
    const next = !excluded[id]
    setBusy(id)
    setExcluded(s => ({ ...s, [id]: next }))   // optimistic
    try {
      const res = await fetch(`/api/admin/tickets/${id}/report-exclusion`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ excluded: next }),
      })
      if (!res.ok) setExcluded(s => ({ ...s, [id]: !next }))   // revert
    } catch {
      setExcluded(s => ({ ...s, [id]: !next }))
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => {
    const m = new Map<string, PreviewItem[]>()
    for (const it of items) {
      const key = it.association_code ?? '—'
      const list = m.get(key)
      if (list) list.push(it)
      else      m.set(key, [it])
    }
    return Array.from(m.entries())
  }, [items])

  const includedCount = items.filter(i => !excluded[i.id]).length

  if (items.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg py-8 text-center text-sm text-gray-400 mb-6">
        No tickets or work orders were created in this month.
      </div>
    )
  }

  return (
    <div className="mb-6">
      <p className="text-xs text-gray-500 mb-2">
        Every ticket and work order created this month is included by default.
        Untick anything that shouldn&apos;t appear in the board report —
        <span className="font-medium text-gray-700"> {includedCount} of {items.length} included</span>.
      </p>
      <div className="space-y-4">
        {groups.map(([code, list]) => {
          const incl = list.filter(i => !excluded[i.id]).length
          return (
            <section key={code} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  {assocNames[code] ?? code}
                  {assocNames[code] && assocNames[code] !== code && (
                    <span className="text-gray-400 font-normal"> · {code}</span>
                  )}
                </h3>
                <span className="text-xs text-gray-500">{incl} of {list.length} included</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {list.map(it => {
                    const isExcluded = !!excluded[it.id]
                    return (
                      <tr key={it.id} className={isExcluded ? 'bg-gray-50/60' : 'hover:bg-gray-50'}>
                        <td className="pl-4 pr-1 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            disabled={busy === it.id}
                            onChange={() => void toggle(it.id)}
                            className="h-4 w-4 accent-[#f26a1b] cursor-pointer"
                            title={isExcluded ? 'Excluded — tick to include' : 'Included — untick to leave out'}
                          />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <Link
                            href={`/admin/tickets/${it.id}`}
                            className={['font-mono', isExcluded ? 'text-gray-400' : 'text-[#f26a1b] hover:underline'].join(' ')}
                          >
                            {it.ticket_number}
                          </Link>
                        </td>
                        <td className="px-2 py-2">
                          <span className={[
                            'inline-block px-1.5 py-0.5 rounded text-[9px] font-medium uppercase',
                            it.type === 'work_order' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700',
                          ].join(' ')}>
                            {it.type === 'work_order' ? 'WO' : 'Ticket'}
                          </span>
                        </td>
                        <td className={['px-2 py-2', isExcluded ? 'text-gray-400 line-through' : 'text-gray-700'].join(' ')}>
                          <div className="line-clamp-1 max-w-[360px]">{it.subject ?? '—'}</div>
                        </td>
                        <td className="px-2 py-2 text-gray-500 capitalize whitespace-nowrap">{it.status ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{fmtDate(it.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
      </div>
    </div>
  )
}
