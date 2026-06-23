'use client'

// =====================================================================
// app/admin/teach/TeachStudioClient.tsx
// The Teach MAIA studio:
//   • a coverage matrix (associations × personas) — the "visual routing"
//   • a teach panel (upload PDF/image or paste text → MAIA reads it)
//   • a review modal: what MAIA understood → approve / correct / edit
// =====================================================================

import { useEffect, useMemo, useState } from 'react'

// Mirrors lib/maia-knowledge.ts TEACH_PERSONAS (kept local so this client
// component doesn't import the server-only lib).
const PERSONAS = [
  { key: 'homeowner', label: 'Owner / Homeowner' },
  { key: 'tenant',    label: 'Tenant' },
  { key: 'board',     label: 'Board Member' },
  { key: 'vendor',    label: 'Vendor' },
  { key: 'buyer',     label: 'Buyer' },
  { key: 'agent',     label: 'Realtor / Agent' },
] as const

const personaLabel = (k: string | null) => k ? (PERSONAS.find(p => p.key === k)?.label ?? k) : 'All personas'

export interface KnowledgeItem {
  id: string
  association_code: string | null
  persona: string | null
  account_number: string | null
  unit_number: string | null
  kind: 'knowledge' | 'behavior'
  title: string
  source_kind: 'text' | 'pdf' | 'image' | 'chat'
  source_filename: string | null
  understood_summary: string | null
  approved_body: string | null
  status: 'needs_review' | 'approved' | 'rejected'
  created_by: string | null
  reviewed_by: string | null
  created_at: string
  updated_at: string
}

interface Assoc { association_code: string; association_name: string }
interface UnitOpt { account_number: string; unit_number: string | null; label: string }

const unitChip = (it: { unit_number: string | null; account_number: string | null }) =>
  it.unit_number ? `Unit ${it.unit_number}` : it.account_number ? `Acct ${it.account_number}` : null

const KIND_ICON: Record<KnowledgeItem['source_kind'], string> = { text: '✍️', pdf: '📄', image: '🖼️', chat: '💬' }

const STATUS_BADGE: Record<KnowledgeItem['status'], { label: string; cls: string }> = {
  needs_review: { label: 'Needs review', cls: 'bg-amber-100 text-amber-800' },
  approved:     { label: 'Approved',     cls: 'bg-green-100 text-green-800' },
  rejected:     { label: 'Rejected',     cls: 'bg-gray-100 text-gray-500' },
}

export default function TeachStudioClient({ initialItems, associations }: { initialItems: KnowledgeItem[]; associations: Assoc[] }) {
  const [items, setItems] = useState<KnowledgeItem[]>(initialItems)
  const [filter, setFilter] = useState<{ assoc: string | null | 'any'; persona: string | null | 'any' }>({ assoc: 'any', persona: 'any' })
  const [review, setReview] = useState<KnowledgeItem | null>(null)
  const assocName = (code: string | null) => code ? (associations.find(a => a.association_code === code)?.association_name ?? code) : 'All associations'

  // ── coverage matrix counts ───────────────────────────────────────
  // rows: [Global, ...associations]; cols: [All personas, ...PERSONAS]
  const counts = useMemo(() => {
    const m = new Map<string, { approved: number; pending: number }>()
    const key = (a: string | null, p: string | null) => `${a ?? '∅'}|${p ?? '∅'}`
    for (const it of items) {
      if (it.status === 'rejected') continue
      const k = key(it.association_code, it.persona)
      const c = m.get(k) ?? { approved: 0, pending: 0 }
      if (it.status === 'approved') c.approved++; else c.pending++
      m.set(k, c)
    }
    return { get: (a: string | null, p: string | null) => m.get(key(a, p)) ?? { approved: 0, pending: 0 } }
  }, [items])

  const filtered = useMemo(() => items.filter(it =>
    (filter.assoc === 'any' || it.association_code === (filter.assoc === null ? null : filter.assoc)) &&
    (filter.persona === 'any' || it.persona === (filter.persona === null ? null : filter.persona)),
  ), [items, filter])

  function upsertItem(it: KnowledgeItem) {
    setItems(prev => {
      const i = prev.findIndex(x => x.id === it.id)
      if (i === -1) return [it, ...prev]
      const next = [...prev]; next[i] = it; return next
    })
    setReview(r => (r && r.id === it.id ? it : r))
  }
  function removeItem(id: string) {
    setItems(prev => prev.filter(x => x.id !== id))
    setReview(r => (r && r.id === id ? null : r))
  }

  const cell = (a: string | null, p: string | null) => {
    const c = counts.get(a, p)
    const active = (filter.assoc === 'any' ? a === null : filter.assoc === a) && (filter.persona === 'any' ? p === null : filter.persona === p)
    const has = c.approved > 0 || c.pending > 0
    return (
      <button
        key={`${a ?? 'g'}-${p ?? 'all'}`}
        onClick={() => setFilter({ assoc: a, persona: p })}
        title={`${c.approved} approved · ${c.pending} pending`}
        className={`h-9 min-w-[3rem] rounded text-xs font-medium border transition ${
          active ? 'ring-2 ring-orange-500 ' : ''
        }${c.approved > 0 ? 'bg-green-50 border-green-200 text-green-800'
          : c.pending > 0 ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-white border-gray-100 text-gray-300'}`}
      >
        {has ? <span>{c.approved}{c.pending ? <span className="text-amber-600">+{c.pending}</span> : null}</span> : '·'}
      </button>
    )
  }

  return (
    <div className="space-y-6">
      <TeachPanel associations={associations} onTaught={(it) => { upsertItem(it); setReview(it) }} />

      {/* ── Coverage matrix (visual routing) ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Knowledge map <span className="font-normal text-gray-400">— click a cell to filter; green = approved, amber = pending</span></h2>
          {(filter.assoc !== 'any' || filter.persona !== 'any') && (
            <button onClick={() => setFilter({ assoc: 'any', persona: 'any' })} className="text-xs text-orange-600 hover:underline">Clear filter</button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-separate" style={{ borderSpacing: '4px' }}>
            <thead>
              <tr>
                <th className="text-left font-medium text-gray-500 px-2 sticky left-0 bg-white">Association ╲ Persona</th>
                <th className="font-medium text-gray-500 px-1">All</th>
                {PERSONAS.map(p => <th key={p.key} className="font-medium text-gray-500 px-1 whitespace-nowrap">{p.label.split(' ')[0]}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-left font-medium text-gray-700 px-2 sticky left-0 bg-white whitespace-nowrap">🌐 Global (all)</td>
                <td>{cell(null, null)}</td>
                {PERSONAS.map(p => <td key={p.key}>{cell(null, p.key)}</td>)}
              </tr>
              {associations.map(a => (
                <tr key={a.association_code}>
                  <td className="text-left text-gray-700 px-2 sticky left-0 bg-white whitespace-nowrap max-w-[14rem] truncate" title={a.association_name}>{a.association_name}</td>
                  <td>{cell(a.association_code, null)}</td>
                  {PERSONAS.map(p => <td key={p.key}>{cell(a.association_code, p.key)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Items list ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-900">
            {filter.assoc === 'any' && filter.persona === 'any' ? 'All knowledge' : `${assocName(filter.assoc === 'any' ? null : filter.assoc)} · ${personaLabel(filter.persona === 'any' ? null : filter.persona as string | null)}`}
            <span className="ml-2 font-normal text-gray-400">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
          </h2>
        </div>
        {filtered.length === 0 ? (
          <div className="text-sm text-gray-400 bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center">No knowledge here yet. Teach MAIA something above.</div>
        ) : (
          <div className="grid gap-2">
            {filtered.map(it => (
              <button key={it.id} onClick={() => setReview(it)} className="text-left bg-white rounded-xl border border-gray-200 hover:border-orange-300 p-3 transition">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span>{it.kind === 'behavior' ? '⚙️' : KIND_ICON[it.source_kind]}</span>
                      <span className="font-medium text-gray-900 truncate">{it.title}</span>
                      {it.kind === 'behavior' && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Rule</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <Chip>{assocName(it.association_code)}</Chip>
                      <Chip>{personaLabel(it.persona)}</Chip>
                      {unitChip(it) && <Chip>🏠 {unitChip(it)}</Chip>}
                      {it.source_filename && <Chip>{it.source_filename}</Chip>}
                    </div>
                    {it.understood_summary && <p className="text-xs text-gray-500 mt-2 line-clamp-2 whitespace-pre-wrap">{it.understood_summary}</p>}
                  </div>
                  <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[it.status].cls}`}>{STATUS_BADGE[it.status].label}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {review && (
        <ReviewModal
          item={review}
          associations={associations}
          onClose={() => setReview(null)}
          onChange={upsertItem}
          onDelete={removeItem}
        />
      )}
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{children}</span>
}

// ── Teach panel ──────────────────────────────────────────────────────
function TeachPanel({ associations, onTaught }: { associations: Assoc[]; onTaught: (it: KnowledgeItem) => void }) {
  const [assoc, setAssoc] = useState('')      // '' = global
  const [persona, setPersona] = useState('')  // '' = all
  const [account, setAccount] = useState('')  // '' = all units; else account_number
  const [units, setUnits] = useState<UnitOpt[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [hint, setHint] = useState('')
  const [kind, setKind] = useState<'knowledge' | 'behavior'>('knowledge')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isRule = kind === 'behavior'

  // Load the association's units/accounts when one is picked (per-unit scope).
  useEffect(() => {
    setAccount('')
    if (!assoc) { setUnits([]); return }
    let cancelled = false
    setUnitsLoading(true)
    fetch(`/api/admin/teach/units?association_code=${encodeURIComponent(assoc)}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setUnits(Array.isArray(j.units) ? j.units : []) })
      .catch(() => { if (!cancelled) setUnits([]) })
      .finally(() => { if (!cancelled) setUnitsLoading(false) })
    return () => { cancelled = true }
  }, [assoc])

  async function submit() {
    setErr(null); setBusy(true)
    try {
      const fd = new FormData()
      if (assoc) fd.set('association_code', assoc)
      if (persona) fd.set('persona', persona)
      if (account) {
        fd.set('account_number', account)
        const u = units.find(x => x.account_number === account)
        if (u?.unit_number) fd.set('unit_number', u.unit_number)
      }
      if (isRule) fd.set('kind', 'behavior')
      // Either text or a file is enough — whichever was provided. If both,
      // the file is the source and the typed text rides along as a note.
      if (file) {
        fd.set('file', file)
        const note = [hint.trim(), text.trim()].filter(Boolean).join(' — ')
        if (note) fd.set('hint', note)
      } else if (text.trim()) {
        fd.set('text', text.trim())
        if (hint.trim()) fd.set('hint', hint.trim())
      } else {
        setErr('Type something to teach, or attach a PDF / image.'); setBusy(false); return
      }
      const res = await fetch('/api/admin/teach/ingest', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setErr(json.error ?? 'Something went wrong.'); setBusy(false); return }
      onTaught(json.item as KnowledgeItem)
      setFile(null); setText(''); setHint('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Teach MAIA something new</h2>

      {/* Knowledge (a fact she uses) vs Behavior rule (how she should respond). */}
      <div className="inline-flex rounded-lg border border-gray-200 p-0.5 mb-3 bg-gray-50">
        <button type="button" onClick={() => setKind('knowledge')}
          className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${!isRule ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
          📚 Knowledge <span className="font-normal text-gray-400">— a fact</span>
        </button>
        <button type="button" onClick={() => setKind('behavior')}
          className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${isRule ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
          ⚙️ Behavior rule <span className="font-normal text-gray-400">— how to respond</span>
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        <label className="text-xs text-gray-600">
          Per association
          <select value={assoc} onChange={e => setAssoc(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">
            <option value="">🌐 All associations (global)</option>
            {associations.map(a => <option key={a.association_code} value={a.association_code}>{a.association_name}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Per persona
          <select value={persona} onChange={e => setPersona(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">
            <option value="">All personas</option>
            {PERSONAS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Per unit / account
          <select value={account} onChange={e => setAccount(e.target.value)} disabled={!assoc || unitsLoading} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400">
            <option value="">{!assoc ? 'Pick an association first' : unitsLoading ? 'Loading units…' : 'All units / accounts'}</option>
            {units.map(u => <option key={u.account_number} value={u.account_number}>{u.label}</option>)}
          </select>
        </label>
      </div>

      <textarea value={text} onChange={e => setText(e.target.value)} rows={isRule ? 3 : 5}
        placeholder={isRule
          ? "Describe how MAIA should respond — e.g. 'When a returning resident has more than one role, ask which role they need help with today before answering.'"
          : 'Type what you want MAIA to know — rules, hours, contacts, procedures…'}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />

      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <input id="teach-file" type="file" accept="application/pdf,image/*" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <label htmlFor="teach-file" className="cursor-pointer text-orange-600 hover:underline">📎 {file ? file.name : 'Attach a PDF or image (optional)'}</label>
        {file && <button type="button" onClick={() => setFile(null)} className="text-gray-400 hover:text-gray-700">✕</button>}
        <span className="text-gray-400">— MAIA reads images with vision, PDFs by text.</span>
      </div>

      <input value={hint} onChange={e => setHint(e.target.value)} placeholder="Optional note to MAIA (e.g. 'these are the pool rules')" className="mt-3 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />

      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button onClick={submit} disabled={busy} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {busy ? 'MAIA is reading…' : 'Teach MAIA →'}
        </button>
        <span className="text-xs text-gray-400">MAIA will show what she understood for you to approve.</span>
      </div>
    </section>
  )
}

// ── Review modal ─────────────────────────────────────────────────────
function ReviewModal({ item, associations, onClose, onChange, onDelete }: {
  item: KnowledgeItem
  associations: Assoc[]
  onClose: () => void
  onChange: (it: KnowledgeItem) => void
  onDelete: (id: string) => void
}) {
  const [body, setBody] = useState(item.approved_body ?? '')
  const [correction, setCorrection] = useState('')
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'save' | 'refine' | 'delete'>(null)
  const [err, setErr] = useState<string | null>(null)
  const assocName = (code: string | null) => code ? (associations.find(a => a.association_code === code)?.association_name ?? code) : 'All associations'
  const dirty = body !== (item.approved_body ?? '')

  async function patch(payload: Record<string, unknown>, which: 'approve' | 'reject' | 'save') {
    setErr(null); setBusy(which)
    try {
      const res = await fetch(`/api/admin/teach/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json()
      if (!res.ok) { setErr(json.error ?? 'Failed'); return }
      onChange(json.item as KnowledgeItem)
      if (which === 'approve' || which === 'reject') onClose()
    } finally { setBusy(null) }
  }

  async function refine() {
    if (!correction.trim()) return
    setErr(null); setBusy('refine')
    try {
      const res = await fetch(`/api/admin/teach/${item.id}/refine`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correction: correction.trim() }) })
      const json = await res.json()
      if (!res.ok) { setErr(json.error ?? 'Failed'); return }
      const updated = json.item as KnowledgeItem
      onChange(updated); setBody(updated.approved_body ?? ''); setCorrection('')
    } finally { setBusy(null) }
  }

  async function del() {
    if (!confirm('Delete this knowledge item?')) return
    setBusy('delete')
    try {
      const res = await fetch(`/api/admin/teach/${item.id}`, { method: 'DELETE' })
      if (res.ok) onDelete(item.id)
    } finally { setBusy(null) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">{item.kind === 'behavior' && '⚙️ '}{item.title}</h3>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {item.kind === 'behavior' && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">Behavior rule</span>}
              <Chip>{assocName(item.association_code)}</Chip>
              <Chip>{personaLabel(item.persona)}</Chip>
              {unitChip(item) && <Chip>🏠 {unitChip(item)}</Chip>}
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[item.status].cls}`}>{STATUS_BADGE[item.status].label}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">{item.kind === 'behavior' ? '🧠 The rule MAIA understood' : '🧠 What MAIA understood'}</p>
            <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100">{item.understood_summary ?? '—'}</div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">{item.kind === 'behavior' ? '⚙️ Rule MAIA will follow (editable)' : '📌 Knowledge MAIA will use (editable)'}</p>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={6} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            {dirty && <button onClick={() => patch({ approved_body: body }, 'save')} disabled={busy === 'save'} className="mt-1 text-xs text-orange-600 hover:underline">{busy === 'save' ? 'Saving…' : 'Save edits'}</button>}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">💬 Correct MAIA</p>
            <div className="flex gap-2">
              <input value={correction} onChange={e => setCorrection(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') refine() }} placeholder="e.g. The pool closes at 10pm, not 8pm" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <button onClick={refine} disabled={busy === 'refine' || !correction.trim()} className="bg-gray-900 disabled:opacity-40 text-white text-sm px-3 py-2 rounded-lg whitespace-nowrap">{busy === 'refine' ? 'Thinking…' : 'Apply'}</button>
            </div>
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-gray-100">
          <button onClick={del} disabled={busy === 'delete'} className="text-xs text-red-500 hover:underline">Delete</button>
          <div className="flex gap-2">
            {item.status !== 'rejected' && <button onClick={() => patch({ status: 'rejected' }, 'reject')} disabled={!!busy} className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Reject</button>}
            {item.status !== 'approved' && <button onClick={() => patch({ status: 'approved', approved_body: body }, 'approve')} disabled={!!busy} className="text-sm px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium">{busy === 'approve' ? 'Approving…' : '✓ Approve & go live'}</button>}
            {item.status === 'approved' && <span className="text-xs text-green-700 self-center">● Live in MAIA&rsquo;s answers</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
