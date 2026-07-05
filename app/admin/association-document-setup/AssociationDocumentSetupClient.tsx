'use client'

import { useEffect, useMemo, useState } from 'react'

interface Requirement {
  id: string; association_code: string; item_key: string; label: string
  occupancy_filter: string | null; active: boolean; created_at: string
}

const OCC_LABEL: Record<string, string> = { owner_occupied: 'Owner-occupied only', leased: 'Leased only', vacant: 'Vacant only' }

export default function AssociationDocumentSetupClient({ associations }: { associations: Array<{ association_code: string; association_name: string }> }) {
  const [assoc, setAssoc] = useState('')
  const [reqs, setReqs] = useState<Requirement[] | null>(null)
  const [label, setLabel] = useState('')
  const [occFilter, setOccFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = () => {
    fetch('/api/admin/association-document-requirements?all=true').then(r => r.json()).then(d => setReqs(d.requirements ?? [])).catch(() => setReqs([]))
  }
  useEffect(load, [])

  const forAssoc = useMemo(() => (reqs ?? []).filter(r => r.association_code === assoc), [reqs, assoc])

  async function add() {
    if (!assoc || !label.trim()) { setMsg({ kind: 'err', text: 'Pick an association and enter a label.' }); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/association-document-requirements', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ associationCode: assoc, label: label.trim(), occupancyFilter: occFilter || null }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setLabel(''); setOccFilter(''); load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  async function toggleActive(r: Requirement) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/association-document-requirements/${r.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: !r.active }),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  async function remove(r: Requirement) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/association-document-requirements/${r.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  const inputCls = 'rounded border border-gray-300 px-3 py-2 text-sm'

  return (
    <div className="space-y-4">
      <select value={assoc} onChange={e => setAssoc(e.target.value)} className={inputCls + ' w-full'}>
        <option value="">Select an association…</option>
        {associations.map(a => <option key={a.association_code} value={a.association_code}>{a.association_name} ({a.association_code})</option>)}
      </select>

      {assoc && (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Add a requirement for {assoc}</div>
            <div className="flex flex-wrap gap-2">
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. City of Lauderhill Certificate of Use"
                className={inputCls + ' flex-1 min-w-[240px]'} />
              <select value={occFilter} onChange={e => setOccFilter(e.target.value)} className={inputCls}>
                <option value="">Always required</option>
                <option value="owner_occupied">Only when owner-occupied</option>
                <option value="leased">Only when leased</option>
                <option value="vacant">Only when vacant</option>
              </select>
              <button onClick={add} disabled={busy} className="rounded bg-[#f26a1b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
                Add
              </button>
            </div>
          </div>

          {msg && <div className={`rounded border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>}

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Label</th>
                  <th className="px-4 py-2.5 font-medium">Applies when</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {forAssoc.map(r => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2.5 text-gray-800">{r.label}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{r.occupancy_filter ? OCC_LABEL[r.occupancy_filter] : 'Always'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
                        {r.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => toggleActive(r)} disabled={busy} className="text-xs text-gray-500 hover:underline">
                          {r.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button onClick={() => remove(r)} disabled={busy} className="text-xs text-red-500 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {forAssoc.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">No custom requirements for this association yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
