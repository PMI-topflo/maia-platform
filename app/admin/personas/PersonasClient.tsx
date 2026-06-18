'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface PersonaRow { name: string; email: string | null; phone: string | null; associationCode: string | null; associationName: string | null; sub: string | null; href: string | null }
type PersonaType = 'owners' | 'tenants' | 'vendors' | 'board' | 'agents'
const TABS: { key: PersonaType; label: string }[] = [
  { key: 'owners', label: 'Owners' }, { key: 'tenants', label: 'Tenants' }, { key: 'vendors', label: 'Vendors' },
  { key: 'board', label: 'Board' }, { key: 'agents', label: 'Agents' },
]

interface MsgItem { channel: string; direction: string | null; when: string | null; title: string | null; body: string | null; associationCode: string | null }

const ET = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : ''
const CHANNEL_ICON: Record<string, string> = { sms: '💬', whatsapp: '🟢', voice: '📞', web: '🌐', email: '✉️', other: '•' }

function MessagesDrawer({ person, onClose }: { person: { name: string; phone: string | null; email: string | null }; onClose: () => void }) {
  const [items, setItems] = useState<MsgItem[] | null>(null)
  useEffect(() => {
    const p = new URLSearchParams()
    if (person.phone) p.set('phone', person.phone)
    if (person.email) p.set('email', person.email)
    fetch(`/api/admin/personas/messages?${p}`).then(r => r.json()).then(d => setItems(d.items ?? [])).catch(() => setItems([]))
  }, [person])
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div onClick={e => e.stopPropagation()} className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">{person.name}</div>
            <div className="text-xs text-gray-400">{[person.phone, person.email].filter(Boolean).join(' · ') || 'no contact on file'}</div>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {!items && <p className="text-sm text-gray-400">Loading messages…</p>}
          {items && items.length === 0 && <p className="text-sm text-gray-400">No messages on file for this person.</p>}
          <div className="space-y-2">
            {(items ?? []).map((m, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-2.5">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>{CHANNEL_ICON[m.channel] ?? '•'} {m.channel}{m.direction ? ` · ${m.direction}` : ''}{m.associationCode ? ` · ${m.associationCode}` : ''}</span>
                  <span>{ET(m.when)}</span>
                </div>
                {m.title && <div className="mt-0.5 text-sm font-medium text-gray-900">{m.title}</div>}
                {m.body && <div className="mt-0.5 line-clamp-3 text-xs text-gray-600">{m.body}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PersonasClient({ associations }: { associations: { code: string; name: string }[] }) {
  const [type, setType] = useState<PersonaType>('owners')
  const [msgPerson, setMsgPerson] = useState<{ name: string; phone: string | null; email: string | null } | null>(null)
  const [assoc, setAssoc] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<PersonaRow[] | null>(null)
  const [vendorsAllScope, setVendorsAllScope] = useState(false)
  const [vendorAssocFallback, setVendorAssocFallback] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (t: PersonaType, a: string, query: string) => {
    setBusy(true)
    try {
      const p = new URLSearchParams({ type: t })
      if (a) p.set('assoc', a)
      if (query.trim()) p.set('q', query.trim())
      const d = await fetch(`/api/admin/personas?${p}`, { cache: 'no-store' }).then(r => r.json())
      setRows(d.rows ?? []); setVendorsAllScope(!!d.vendorsAllScope); setVendorAssocFallback(!!d.vendorAssocFallback)
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
        <select value={assoc} onChange={e => setAssoc(e.target.value)} disabled={type === 'agents'} className="rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-700 disabled:opacity-50">
          <option value="">All associations</option>
          {associations.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
        </select>
        <span className="text-xs text-gray-400">{busy ? 'Loading…' : rows ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : ''}</span>
        {type === 'vendors' && vendorsAllScope && <span className="text-xs text-amber-600">Vendors are searched across all of CINC (not association-scoped).</span>}
        {type === 'vendors' && vendorAssocFallback && <span className="text-xs text-amber-600">CINC has no vendors linked to this association — showing all CINC vendors. Search to find one.</span>}
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
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {(r.phone || r.email) && (
                      <button onClick={() => setMsgPerson({ name: r.name, phone: r.phone, email: r.email })} className="text-xs font-medium text-blue-600 hover:underline">Messages</button>
                    )}
                    {r.href && <Link href={r.href} className="text-xs font-medium text-[#f26a1b] hover:underline">Manage →</Link>}
                  </div>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">{busy ? 'Loading…' : 'No matches.'}</td></tr>}
            {!rows && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">Click <span className="font-medium text-blue-600">Messages</span> on any row to see that person&apos;s SMS / WhatsApp / voice / email history.</p>
      {msgPerson && <MessagesDrawer person={msgPerson} onClose={() => setMsgPerson(null)} />}
    </div>
  )
}
