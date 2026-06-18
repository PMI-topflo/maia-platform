'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface PersonaRow { name: string; email: string | null; phone: string | null; associationCode: string | null; associationName: string | null; sub: string | null; href: string | null }
type PersonaType = 'owners' | 'tenants' | 'vendors' | 'board' | 'agents'
const TABS: { key: PersonaType; label: string }[] = [
  { key: 'owners', label: 'Owners' }, { key: 'tenants', label: 'Tenants' }, { key: 'vendors', label: 'Vendors' },
  { key: 'board', label: 'Board' }, { key: 'agents', label: 'Agents' },
]

export default function PersonasClient({ associations }: { associations: { code: string; name: string }[] }) {
  const [type, setType] = useState<PersonaType>('owners')
  const [assoc, setAssoc] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<PersonaRow[] | null>(null)
  const [vendorsAllScope, setVendorsAllScope] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (t: PersonaType, a: string, query: string) => {
    setBusy(true)
    try {
      const p = new URLSearchParams({ type: t })
      if (a) p.set('assoc', a)
      if (query.trim()) p.set('q', query.trim())
      const d = await fetch(`/api/admin/personas?${p}`, { cache: 'no-store' }).then(r => r.json())
      setRows(d.rows ?? []); setVendorsAllScope(!!d.vendorsAllScope)
    } catch { setRows([]) } finally { setBusy(false) }
  }, [])

  // Debounced reload on type/assoc/q change.
  useEffect(() => {
    const h = setTimeout(() => void load(type, assoc, q), 300)
    return () => clearTimeout(h)
  }, [type, assoc, q, load])

  return (
    <div>
      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setType(t.key); setQ('') }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${type === t.key ? 'border-[#f26a1b] text-[#f26a1b]' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>{t.label}</button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search name, email, phone…" className="w-72 rounded border border-gray-300 px-3 py-1.5 text-sm" />
        <select value={assoc} onChange={e => setAssoc(e.target.value)} disabled={type === 'vendors' || type === 'agents'} className="rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-700 disabled:opacity-50">
          <option value="">All associations</option>
          {associations.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
        </select>
        <span className="text-xs text-gray-400">{busy ? 'Loading…' : rows ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : ''}</span>
        {type === 'vendors' && vendorsAllScope && <span className="text-xs text-amber-600">Vendors are searched across all of CINC (not association-scoped).</span>}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 font-medium">{type === 'board' ? 'Role' : type === 'vendors' ? 'Address' : 'Unit'}</th>
              <th className="px-4 py-2.5 font-medium">Association</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows?.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-900">{r.name}</td>
                <td className="px-4 py-2 text-gray-600">{r.email ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2 text-gray-600">{r.phone ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2 text-gray-500">{r.sub ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2 text-gray-500">{r.associationName ?? r.associationCode ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2 text-right">{r.href && <Link href={r.href} className="text-xs font-medium text-[#f26a1b] hover:underline">Manage →</Link>}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">{busy ? 'Loading…' : 'No matches.'}</td></tr>}
            {!rows && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">Per-person message history (SMS / WhatsApp / email) is coming in a follow-up.</p>
    </div>
  )
}
