'use client'

// =====================================================================
// ProjectsTab.tsx — Association Hub Projects tab. Capital / large projects
// with budget + % progress. Lazy-loaded on tab open; CRUD via
// /api/admin/associations/projects. Mounted only when the tab is open.
// =====================================================================

import { useEffect, useState } from 'react'

interface Project {
  id: string; name: string; status: string; vendor_name: string | null
  budget: number | null; spent: number | null; target_date: string | null
  pct_complete: number; notes: string | null
}

const STATUSES = ['planning', 'bidding', 'in_progress', 'on_hold', 'complete'] as const
const STATUS_LABEL: Record<string, string> = { planning: 'Planning', bidding: 'Bidding', in_progress: 'In progress', on_hold: 'On hold', complete: 'Complete' }
const STATUS_STYLE: Record<string, string> = {
  planning: 'bg-gray-100 text-gray-700', bidding: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800', on_hold: 'bg-orange-100 text-orange-800', complete: 'bg-emerald-100 text-emerald-800',
}
const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ProjectsTab({ assoc }: { assoc: string }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/associations/projects?assoc=${encodeURIComponent(assoc)}`)
      .then(r => r.json())
      .then((d: { projects?: Project[]; error?: string }) => {
        if (!live) return
        if (d.error) { setError(d.error); setLoading(false); return }
        setProjects(d.projects ?? []); setLoading(false)
      })
      .catch(e => { if (live) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { live = false }
  }, [assoc])

  const list = projects ?? []
  const active = list.filter(p => p.status !== 'complete')
  const committed = list.reduce((s, p) => s + (p.budget ?? 0), 0)
  const spent = list.reduce((s, p) => s + (p.spent ?? 0), 0)

  async function remove(id: string) {
    if (!window.confirm('Remove this project?')) return
    setProjects(prev => (prev ?? []).filter(p => p.id !== id))
    await fetch(`/api/admin/associations/projects/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active projects" value={String(active.length)} />
        <Stat label="In bidding" value={String(list.filter(p => p.status === 'bidding').length)} />
        <Stat label="Committed budget" value={money(committed)} />
        <Stat label="Spent to date" value={money(spent)} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Capital &amp; large projects</h3>
          <button onClick={() => setAddOpen(true)} className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]">+ New project</button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!loading && list.length === 0 && <p className="text-xs text-gray-400">No projects yet. Add a capital or large project (roof, recert, repaint…).</p>}
        {list.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-1 text-left font-semibold">Project</th><th className="pb-1 text-left font-semibold">Status</th>
              <th className="pb-1 text-left font-semibold">Vendor</th><th className="pb-1 text-right font-semibold">Budget</th>
              <th className="pb-1 text-right font-semibold">Spent</th><th className="pb-1 text-left font-semibold">Progress</th>
              <th className="pb-1 text-left font-semibold">Target</th><th className="pb-1"></th>
            </tr></thead>
            <tbody>
              {list.map(p => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-gray-900">{p.name}</td>
                  <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLE[p.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[p.status] ?? p.status}</span></td>
                  <td className="py-1.5 text-gray-500">{p.vendor_name ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.budget)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.spent)}</td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 rounded bg-gray-100"><div className="h-2 rounded bg-[#f26a1b]" style={{ width: `${p.pct_complete}%` }} /></div>
                      <span className="text-[11px] text-gray-500">{p.pct_complete}%</span>
                    </div>
                  </td>
                  <td className="py-1.5 text-gray-500">{p.target_date ?? '—'}</td>
                  <td className="py-1.5 text-right"><button onClick={() => remove(p.id)} className="text-xs text-gray-400 hover:text-red-600">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && <AddProjectModal assoc={assoc} onClose={() => setAddOpen(false)} onCreated={p => { setProjects(prev => [...(prev ?? []), p]); setAddOpen(false) }} />}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-xl font-semibold text-gray-900">{value}</div></div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span>{children}</label>
}

function AddProjectModal({ assoc, onClose, onCreated }: { assoc: string; onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('')
  const [status, setStatus] = useState<string>('planning')
  const [vendor, setVendor] = useState('')
  const [budget, setBudget] = useState('')
  const [spent, setSpent] = useState('')
  const [pct, setPct] = useState('0')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) { setErr('Project name is required.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/associations/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          association_code: assoc, name: name.trim(), status, vendor_name: vendor.trim() || null,
          budget: budget ? Number(budget) : null, spent: spent ? Number(spent) : null,
          pct_complete: Number(pct) || 0, target_date: target || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      onCreated(data.project as Project)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-4">
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
        <div className="text-base font-bold text-gray-900">New project</div>
        <div className="mt-4 space-y-3">
          <Field label="Project name"><input value={name} onChange={e => setName(e.target.value)} placeholder="Roof replacement — Bldg A" className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={status} onChange={e => setStatus(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Vendor (optional)"><input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Apex Roofing" className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Budget"><input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0" className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
            <Field label="Spent"><input type="number" value={spent} onChange={e => setSpent(e.target.value)} placeholder="0" className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
            <Field label="% done"><input type="number" min={0} max={100} value={pct} onChange={e => setPct(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
          </div>
          <Field label="Target date (optional)"><input type="date" value={target} onChange={e => setTarget(e.target.value)} className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm" /></Field>
        </div>
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{busy ? 'Saving…' : 'Add project'}</button>
        </div>
      </div>
    </div>
  )
}
