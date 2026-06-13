'use client'

// =====================================================================
// AssociationUnitDocs.tsx — the unit/owner document list for one association
// in the Compliance Hub. Each owner shows how many unit documents are on
// file vs missing; expand to see each item's status + the filed document.
// =====================================================================

import { useEffect, useMemo, useState } from 'react'
import { categoriesForScope, STATUS_LABEL, STATUS_STYLE, type ComplianceStatus } from '@/lib/compliance-taxonomy'

const UNIT_ITEMS = categoriesForScope('unit').flatMap(c => c.items)

interface OwnerOpt { account_number: string; label: string; unit_number: string | null }
interface Rec { unit_ref: string; item_key: string; status: ComplianceStatus; expiry_date: string | null; source_path: string | null }
const onFile = (s: ComplianceStatus | undefined) => !!s && s !== 'missing' && s !== 'na'

export default function AssociationUnitDocs({ assocCode }: { assocCode: string }) {
  const [owners, setOwners] = useState<OwnerOpt[]>([])
  const [byUnit, setByUnit] = useState<Map<string, Map<string, Rec>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/compliance/units?assoc=${encodeURIComponent(assocCode)}`)
      .then(r => r.json())
      .then((d: { owners?: OwnerOpt[]; records?: Rec[] }) => {
        if (!live) return
        setOwners(d.owners ?? [])
        const m = new Map<string, Map<string, Rec>>()
        for (const r of d.records ?? []) {
          if (!m.has(r.unit_ref)) m.set(r.unit_ref, new Map())
          m.get(r.unit_ref)!.set(r.item_key, r)
        }
        setByUnit(m)
      })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [assocCode])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? owners.filter(o => o.label.toLowerCase().includes(needle)) : owners
  }, [owners, q])

  if (loading) return <p className="text-sm text-gray-500">Loading units…</p>
  if (owners.length === 0) return <p className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500">No owners on file for this association.</p>

  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search owner / unit…"
        className="mb-3 w-full max-w-xs rounded border border-gray-300 px-2.5 py-1.5 text-sm" />
      <div className="space-y-1.5">
        {filtered.map(o => {
          const recs = byUnit.get(o.account_number) ?? new Map<string, Rec>()
          const present = UNIT_ITEMS.filter(i => onFile(recs.get(i.key)?.status)).length
          const total = UNIT_ITEMS.length
          const isOpen = open === o.account_number
          const pct = Math.round((present / total) * 100)
          return (
            <div key={o.account_number} className="rounded-lg border border-gray-200 bg-white">
              <button onClick={() => setOpen(isOpen ? null : o.account_number)} className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50">
                <span className="flex items-center gap-2"><span className="text-gray-400">{isOpen ? '▾' : '▸'}</span><span className="text-sm font-medium text-gray-900">{o.label}</span></span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${pct >= 80 ? 'bg-emerald-100 text-emerald-800' : pct >= 40 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{present}/{total} on file</span>
              </button>
              {isOpen && (
                <div className="border-t border-gray-100 px-4 py-2">
                  <table className="w-full text-sm">
                    <tbody>
                      {UNIT_ITEMS.map(item => {
                        const r = recs.get(item.key)
                        const status = r?.status ?? 'missing'
                        return (
                          <tr key={item.key} className="border-t border-gray-50">
                            <td className="py-1.5 text-gray-900">{item.label}</td>
                            <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span></td>
                            <td className="py-1.5 text-[11px] text-gray-500">{r?.expiry_date ?? ''}</td>
                            <td className="py-1.5 text-right">
                              {r?.source_path
                                ? <a href={`/api/admin/compliance/file?assoc=${encodeURIComponent(assocCode)}&scope=unit&unit=${encodeURIComponent(o.account_number)}&item=${encodeURIComponent(item.key)}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-[#c2410c] hover:underline">📎 View</a>
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
