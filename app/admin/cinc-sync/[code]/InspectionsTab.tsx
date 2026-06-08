'use client'

// =====================================================================
// InspectionsTab.tsx — Association Hub Inspections tab. Compliance certs
// (SB-4D milestone, reserve study, fire, elevator) with next-due dates;
// status derived from next_due. Lazy-loaded; CRUD via
// /api/admin/associations/inspections.
// =====================================================================

import { useEffect, useState } from 'react'

interface Inspection {
  id: string; inspection_type: string; last_done: string | null; next_due: string | null
  inspector: string | null; notes: string | null
}

const PRESETS = ['Milestone inspection (SB-4D)', 'Reserve study', 'Fire alarm / sprinkler', 'Elevator certification', 'Backflow / water', 'Wind mitigation', 'Roof inspection']
const SOON_DAYS = 60

type St = 'current' | 'due' | 'overdue' | 'unknown'
function statusOf(next: string | null): St {
  if (!next) return 'unknown'
  const ms = new Date(next + 'T12:00:00').getTime() - Date.now()
  if (ms < 0) return 'overdue'
  if (ms < SOON_DAYS * 86400000) return 'due'
  return 'current'
}
const ST_LABEL: Record<St, string> = { current: 'Current', due: 'Due soon', overdue: 'Overdue', unknown: '—' }
const ST_STYLE: Record<St, string> = { current: 'bg-emerald-100 text-emerald-800', due: 'bg-amber-100 text-amber-800', overdue: 'bg-red-100 text-red-800', unknown: 'bg-gray-100 text-gray-500' }

export default function InspectionsTab({ assoc }: { assoc: string }) {
  const [items, setItems] = useState<Inspection[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/associations/inspections?assoc=${encodeURIComponent(assoc)}`)
      .then(r => r.json())
      .then((d: { inspections?: Inspection[]; error?: string }) => {
        if (!live) return
        if (d.error) { setError(d.error); setLoading(false); return }
        setItems(d.inspections ?? []); setLoading(false)
      })
      .catch(e => { if (live) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { live = false }
  }, [assoc])

  const list = items ?? []
  const overdue = list.filter(i => statusOf(i.next_due) === 'overdue').length
  const due = list.filter(i => statusOf(i.next_due) === 'due').length

  async function remove(id: string) {
    if (!window.confirm('Remove this inspection?')) return
    setItems(prev => (prev ?? []).filter(i => i.id !== id))
    await fetch(`/api/admin/associations/inspections/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tracked" value={String(list.length)} />
        <Stat label="Due soon" value={String(due)} tone={due > 0 ? 'warn' : 'ok'} />
        <Stat label="Overdue" value={String(overdue)} tone={overdue > 0 ? 'bad' : 'ok'} />
        <Stat label="Current" value={String(list.filter(i => statusOf(i.next_due) === 'current').length)} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Inspections &amp; compliance certifications</h3>
          <button onClick={() => setAddOpen(true)} className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]">+ Add inspection</button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!loading && list.length === 0 && <p className="text-xs text-gray-400">No inspections tracked yet. Add SB-4D milestone, reserve study, fire, elevator…</p>}
        {list.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-1 text-left font-semibold">Inspection</th><th className="pb-1 text-left font-semibold">Last done</th>
              <th className="pb-1 text-left font-semibold">Next due</th><th className="pb-1 text-left font-semibold">Status</th>
              <th className="pb-1 text-left font-semibold">Inspector</th><th className="pb-1"></th>
            </tr></thead>
            <tbody>
              {list.map(i => {
                const st = statusOf(i.next_due)
                return (
                  <tr key={i.id} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium text-gray-900">{i.inspection_type}</td>
                    <td className="py-1.5 text-gray-500">{i.last_done ?? '—'}</td>
                    <td className="py-1.5 text-gray-700">{i.next_due ?? '—'}</td>
                    <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${ST_STYLE[st]}`}>{ST_LABEL[st]}</span></td>
                    <td className="py-1.5 text-gray-500">{i.inspector ?? '—'}</td>
                    <td className="py-1.5 text-right"><button onClick={() => remove(i.id)} className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && <AddInspectionModal assoc={assoc} onClose={() => setAddOpen(false)} onCreated={i => { setItems(prev => [...(prev ?? []), i]); setAddOpen(false) }} />}
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const ring = tone === 'bad' ? 'border-red-200' : tone === 'warn' ? 'border-amber-200' : 'border-gray-200'
  return <div className={`rounded-lg border bg-white p-4 ${ring}`}><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-xl font-semibold text-gray-900">{value}</div></div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span>{children}</label>
}

function AddInspectionModal({ assoc, onClose, onCreated }: { assoc: string; onClose: () => void; onCreated: (i: Inspection) => void }) {
  const [type, setType] = useState(PRESETS[0])
  const [custom, setCustom] = useState('')
  const [lastDone, setLastDone] = useState('')
  const [nextDue, setNextDue] = useState('')
  const [inspector, setInspector] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const inspectionType = type === '__custom' ? custom.trim() : type
    if (!inspectionType) { setErr('Inspection type is required.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/associations/inspections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ association_code: assoc, inspection_type: inspectionType, last_done: lastDone || null, next_due: nextDue || null, inspector: inspector.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      onCreated(data.inspection as Inspection)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-4">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
        <div className="text-base font-bold text-gray-900">Add inspection</div>
        <div className="mt-4 space-y-3">
          <Field label="Inspection type">
            <select value={type} onChange={e => setType(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              {PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
              <option value="__custom">Other…</option>
            </select>
          </Field>
          {type === '__custom' && <Field label="Custom type"><input value={custom} onChange={e => setCustom(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Last done"><input type="date" value={lastDone} onChange={e => setLastDone(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
            <Field label="Next due"><input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
          </div>
          <Field label="Inspector (optional)"><input value={inspector} onChange={e => setInspector(e.target.value)} placeholder="StructEng FL" className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
        </div>
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{busy ? 'Saving…' : 'Add inspection'}</button>
        </div>
      </div>
    </div>
  )
}
