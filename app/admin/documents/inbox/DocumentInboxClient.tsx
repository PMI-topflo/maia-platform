'use client'

// =====================================================================
// DocumentInboxClient.tsx — bulk upload → MAIA classifies → review queue.
// Each uploaded file becomes a card with MAIA's suggested association +
// compliance item pre-selected; staff confirms/edits and applies (writes
// the compliance_records item) or dismisses. Association scope (v1).
// =====================================================================

import { useEffect, useState } from 'react'
import { categoriesForScope } from '@/lib/compliance-taxonomy'

export interface AssocOpt { code: string; name: string }

const CATS = categoriesForScope('association')
const itemsFor = (catKey: string) => CATS.find(c => c.key === catKey)?.items ?? []
const catOfItem = (itemKey: string | null) => itemKey ? (itemKey.split('.')[0] || null) : null
const confBadge = (c: number) => c >= 0.8 ? 'bg-emerald-100 text-emerald-800' : c >= 0.5 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'

interface Row {
  id: string; filename: string | null; summary: string | null; doc_type: string | null
  confidence: number; model: string | null
  association_code: string; category: string; item_key: string
  effective_date: string; expiration_date: string
  busy?: boolean; err?: string | null
}

interface RawRow {
  id: string; filename: string | null; summary: string | null; doc_type: string | null
  confidence: number | null; model: string | null
  suggested_association_code: string | null; suggested_category: string | null; suggested_item_key: string | null
  effective_date: string | null; expiration_date: string | null
}
function toRow(r: RawRow): Row {
  const category = r.suggested_category || catOfItem(r.suggested_item_key) || CATS[0].key
  return {
    id: r.id, filename: r.filename, summary: r.summary, doc_type: r.doc_type,
    confidence: r.confidence ?? 0, model: r.model,
    association_code: r.suggested_association_code ?? '', category,
    item_key: r.suggested_item_key ?? '', effective_date: r.effective_date ?? '', expiration_date: r.expiration_date ?? '',
  }
}

export default function DocumentInboxClient({ associations }: { associations: AssocOpt[] }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/admin/documents/inbox?status=review').then(r => r.json())
      .then((d: { rows?: RawRow[] }) => { if (live) setRows((d.rows ?? []).map(toRow)) })
      .catch(() => {}).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  function patch(id: string, p: Partial<Row>) { setRows(rs => rs.map(r => r.id === id ? { ...r, ...p } : r)) }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    setUploading({ done: 0, total: list.length }); setError(null)
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      try {
        const urlRes = await fetch('/api/admin/documents/inbox/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.name }) })
        const urlData = await urlRes.json()
        if (!urlRes.ok) throw new Error(urlData?.error ?? 'upload URL failed')
        const put = await fetch(urlData.signed_url, { method: 'PUT', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f })
        if (!put.ok) throw new Error(`upload failed (${put.status})`)
        const exRes = await fetch('/api/admin/documents/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage_path: urlData.storage_path, filename: f.name, mime_type: f.type || 'application/pdf' }) })
        const ex = await exRes.json()
        if (!exRes.ok) throw new Error(ex?.error ?? 'classification failed')
        setRows(rs => [toRow(ex.row as RawRow), ...rs])
      } catch (e) { setError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
      setUploading({ done: i + 1, total: list.length })
    }
    setUploading(null)
  }

  async function apply(row: Row) {
    if (!row.association_code) { patch(row.id, { err: 'Pick an association first.' }); return }
    if (!row.item_key) { patch(row.id, { err: 'Pick what this document is.' }); return }
    patch(row.id, { busy: true, err: null })
    try {
      const res = await fetch(`/api/admin/documents/inbox/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', association_code: row.association_code, item_key: row.item_key, effective_date: row.effective_date || null, expiration_date: row.expiration_date || null }) })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'apply failed')
      setRows(rs => rs.filter(r => r.id !== row.id))
    } catch (e) { patch(row.id, { busy: false, err: e instanceof Error ? e.message : String(e) }) }
  }
  async function dismiss(id: string) {
    patch(id, { busy: true })
    await fetch(`/api/admin/documents/inbox/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss' }) }).catch(() => {})
    setRows(rs => rs.filter(r => r.id !== id))
  }

  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#f26a1b]/40 bg-[#fff8f4] px-6 py-8 text-center hover:border-[#f26a1b]">
        <input type="file" accept="application/pdf,image/*" multiple className="hidden" disabled={uploading !== null} onChange={e => onFiles(e.target.files)} />
        <span className="text-sm font-medium text-gray-800">{uploading ? `MAIA is reading… ${uploading.done}/${uploading.total}` : '📥 Drop PDFs here or click to upload (multiple OK)'}</span>
        <span className="mt-1 text-xs text-gray-500">MAIA reads each and suggests the association + compliance item.</span>
      </label>

      {error && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold text-gray-900">Needs review {rows.length > 0 && <span className="text-gray-400">· {rows.length}</span>}</div>
        {loading ? <p className="text-sm text-gray-500">Loading…</p>
          : rows.length === 0 ? <p className="rounded border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">Nothing waiting. Upload documents above.</p>
          : (
            <div className="space-y-3">
              {rows.map(row => {
                const assocMissing = !row.association_code
                return (
                  <div key={row.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{row.filename ?? 'document'}</span>
                        {row.doc_type && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{row.doc_type}</span>}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confBadge(row.confidence)}`}>{Math.round(row.confidence * 100)}% sure</span>
                        {row.model && <span className="text-[10px] text-gray-400">{row.model}</span>}
                      </div>
                    </div>
                    {row.summary && <p className="mb-2 text-xs text-gray-500">MAIA: {row.summary}</p>}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <Field label={`Association${assocMissing ? ' — pick' : ''}`}>
                        <select value={row.association_code} onChange={e => patch(row.id, { association_code: e.target.value, err: null })}
                          className={`w-full rounded border px-1.5 py-1 text-[11px] ${assocMissing ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
                          <option value="">— select —</option>
                          {associations.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
                        </select>
                      </Field>
                      <Field label="Category">
                        <select value={row.category} onChange={e => patch(row.id, { category: e.target.value, item_key: '' })} className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]">
                          {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Document is">
                        <select value={row.item_key} onChange={e => patch(row.id, { item_key: e.target.value })} className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]">
                          <option value="">— select —</option>
                          {itemsFor(row.category).map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Effective"><input type="date" value={row.effective_date} onChange={e => patch(row.id, { effective_date: e.target.value })} className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]" /></Field>
                      <Field label="Expiration"><input type="date" value={row.expiration_date} onChange={e => patch(row.id, { expiration_date: e.target.value })} className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]" /></Field>
                    </div>
                    {row.err && <div className="mt-2 text-[11px] text-red-600">{row.err}</div>}
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button onClick={() => dismiss(row.id)} disabled={row.busy} className="text-xs text-gray-400 hover:text-red-600">Dismiss</button>
                      <button onClick={() => apply(row)} disabled={row.busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{row.busy ? 'Filing…' : 'File it'}</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[9px] uppercase tracking-wide text-gray-400">{label}</span>{children}</label>
}
