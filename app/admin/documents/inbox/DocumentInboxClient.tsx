'use client'

// =====================================================================
// DocumentInboxClient.tsx — bulk upload → MAIA classifies → review queue.
// Each uploaded file becomes a card with MAIA's suggested association +
// compliance item pre-selected; staff confirms/edits and applies (writes
// the compliance_records item) or dismisses. Association AND unit/owner
// scope: unit-level docs (lease, HO-6, registrations…) also pick the owner.
// =====================================================================

import { useEffect, useState } from 'react'
import { COMPLIANCE_TAXONOMY } from '@/lib/compliance-taxonomy'

export interface AssocOpt { code: string; name: string }
interface OwnerOpt { account_number: string; label: string }

const CATS = COMPLIANCE_TAXONOMY
const itemsFor = (catKey: string) => CATS.find(c => c.key === catKey)?.items ?? []
const scopeOfCat = (catKey: string): 'association' | 'unit' => CATS.find(c => c.key === catKey)?.scope ?? 'association'
const catOfItem = (itemKey: string | null) => itemKey ? (itemKey.split('.')[0] || null) : null
const confBadge = (c: number) => c >= 0.8 ? 'bg-emerald-100 text-emerald-800' : c >= 0.5 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'

interface Row {
  id: string; filename: string | null; summary: string | null; doc_type: string | null
  confidence: number; model: string | null
  association_code: string; category: string; item_key: string
  unit_ref: string; unit_label: string | null
  effective_date: string; expiration_date: string
  source_storage_path: string | null; page_start: number | null; page_end: number | null
  busy?: boolean; err?: string | null
}

interface RawRow {
  id: string; filename: string | null; summary: string | null; doc_type: string | null
  confidence: number | null; model: string | null
  suggested_association_code: string | null; suggested_category: string | null; suggested_item_key: string | null
  suggested_scope: string | null; suggested_unit_ref: string | null; suggested_unit_label: string | null
  effective_date: string | null; expiration_date: string | null
  source_storage_path: string | null; page_start: number | null; page_end: number | null
}
function toRow(r: RawRow): Row {
  const category = r.suggested_category || catOfItem(r.suggested_item_key) || CATS[0].key
  return {
    id: r.id, filename: r.filename, summary: r.summary, doc_type: r.doc_type,
    confidence: r.confidence ?? 0, model: r.model,
    association_code: r.suggested_association_code ?? '', category,
    item_key: r.suggested_item_key ?? '',
    unit_ref: r.suggested_unit_ref ?? '', unit_label: r.suggested_unit_label,
    effective_date: r.effective_date ?? '', expiration_date: r.expiration_date ?? '',
    source_storage_path: r.source_storage_path, page_start: r.page_start, page_end: r.page_end,
  }
}

export default function DocumentInboxClient({ associations }: { associations: AssocOpt[] }) {
  const [rows, setRows] = useState<Row[]>([])
  const [owners, setOwners] = useState<Record<string, OwnerOpt[]>>({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Set<string>>(new Set())

  function togglePreview(id: string) {
    setPreview(p => { const s = new Set(p); if (s.has(id)) s.delete(id); else s.add(id); return s })
  }

  async function ensureOwners(code: string) {
    if (!code || owners[code]) return
    try {
      const d = await fetch(`/api/admin/compliance/units?assoc=${encodeURIComponent(code)}`).then(r => r.json())
      setOwners(o => ({ ...o, [code]: (d.owners ?? []) as OwnerOpt[] }))
    } catch { setOwners(o => ({ ...o, [code]: [] })) }
  }

  useEffect(() => {
    let live = true
    fetch('/api/admin/documents/inbox?status=review').then(r => r.json())
      .then((d: { rows?: RawRow[] }) => {
        if (!live) return
        const mapped = (d.rows ?? []).map(toRow)
        setRows(mapped)
        for (const r of mapped) if (scopeOfCat(r.category) === 'unit' && r.association_code) ensureOwners(r.association_code)
      })
      .catch(() => {}).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // One file can yield several rows (MAIA split a multi-policy packet).
        const newRows = ((ex.rows ?? (ex.row ? [ex.row] : [])) as RawRow[]).map(toRow)
        setRows(rs => [...newRows, ...rs])
        for (const row of newRows) if (scopeOfCat(row.category) === 'unit' && row.association_code) ensureOwners(row.association_code)
      } catch (e) { setError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
      setUploading({ done: i + 1, total: list.length })
    }
    setUploading(null)
  }

  async function apply(row: Row) {
    const scope = scopeOfCat(row.category)
    if (!row.association_code) { patch(row.id, { err: 'Pick an association first.' }); return }
    if (!row.item_key) { patch(row.id, { err: 'Pick what this document is.' }); return }
    if (scope === 'unit' && !row.unit_ref) { patch(row.id, { err: 'Pick the owner/unit this belongs to.' }); return }
    patch(row.id, { busy: true, err: null })
    try {
      const res = await fetch(`/api/admin/documents/inbox/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', scope, association_code: row.association_code, unit_ref: row.unit_ref || null, item_key: row.item_key, effective_date: row.effective_date || null, expiration_date: row.expiration_date || null }) })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'apply failed')
      setRows(rs => rs.filter(r => r.id !== row.id))
    } catch (e) { patch(row.id, { busy: false, err: e instanceof Error ? e.message : String(e) }) }
  }
  async function dismiss(id: string) {
    patch(id, { busy: true })
    await fetch(`/api/admin/documents/inbox/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss' }) }).catch(() => {})
    setRows(rs => rs.filter(r => r.id !== id))
  }

  // The contiguous split sibling immediately before this piece (same packet,
  // page_end == this.page_start - 1) — the one to append into.
  function prevSibling(row: Row): Row | null {
    if (!row.source_storage_path || row.page_start == null) return null
    return rows.find(r => r.id !== row.id && r.source_storage_path === row.source_storage_path && r.page_end != null && r.page_end === (row.page_start as number) - 1) ?? null
  }
  async function mergePrev(row: Row, prev: Row) {
    patch(row.id, { busy: true, err: null })
    try {
      const res = await fetch(`/api/admin/documents/inbox/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'merge_prev', prev_id: prev.id }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'merge failed')
      setRows(rs => rs.filter(r => r.id !== row.id).map(r => r.id === prev.id ? { ...r, page_end: j.page_end ?? r.page_end } : r))
      setPreview(p => { const s = new Set(p); s.delete(prev.id); return s })   // force preview reload on reopen
    } catch (e) { patch(row.id, { busy: false, err: e instanceof Error ? e.message : String(e) }) }
  }

  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#f26a1b]/40 bg-[#fff8f4] px-6 py-8 text-center hover:border-[#f26a1b]">
        <input type="file" accept="application/pdf,image/*" multiple className="hidden" disabled={uploading !== null} onChange={e => onFiles(e.target.files)} />
        <span className="text-sm font-medium text-gray-800">{uploading ? `MAIA is reading… ${uploading.done}/${uploading.total}` : '📥 Drop PDFs here or click to upload (multiple OK)'}</span>
        <span className="mt-1 text-xs text-gray-500">MAIA reads each and suggests the association, the owner/unit (for unit docs), and the compliance item.</span>
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
                const scope = scopeOfCat(row.category)
                const isUnit = scope === 'unit'
                const ownerOpts = owners[row.association_code] ?? []
                const prev = prevSibling(row)
                return (
                  <div key={row.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{row.filename ?? 'document'}</span>
                        {row.doc_type && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{row.doc_type}</span>}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isUnit ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>{isUnit ? 'Unit / owner' : 'Association'}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confBadge(row.confidence)}`}>{Math.round(row.confidence * 100)}% sure</span>
                        {row.model && <span className="text-[10px] text-gray-400">{row.model}</span>}
                      </div>
                    </div>
                    {row.summary && <p className="mb-2 text-xs text-gray-500">MAIA: {row.summary}</p>}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <Field label={`Association${assocMissing ? ' — pick' : ''}`}>
                        <select value={row.association_code} onChange={e => { patch(row.id, { association_code: e.target.value, unit_ref: '', err: null }); if (scopeOfCat(row.category) === 'unit') ensureOwners(e.target.value) }}
                          className={`w-full rounded border px-1.5 py-1 text-[11px] ${assocMissing ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
                          <option value="">— select —</option>
                          {associations.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
                        </select>
                      </Field>
                      <Field label="Category">
                        <select value={row.category} onChange={e => { patch(row.id, { category: e.target.value, item_key: '', unit_ref: '' }); if (scopeOfCat(e.target.value) === 'unit' && row.association_code) ensureOwners(row.association_code) }} className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]">
                          {CATS.map(c => <option key={c.key} value={c.key}>{c.label}{c.scope === 'unit' ? ' (unit)' : ''}</option>)}
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
                    {isUnit && (
                      <div className="mt-2">
                        <Field label={`Owner / unit${row.unit_ref ? '' : ' — pick'}`}>
                          <select value={row.unit_ref} onChange={e => patch(row.id, { unit_ref: e.target.value, err: null })}
                            disabled={!row.association_code}
                            className={`w-full rounded border px-1.5 py-1 text-[11px] ${!row.unit_ref ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
                            <option value="">{!row.association_code ? 'pick an association first' : ownerOpts.length ? '— select owner —' : 'loading owners…'}</option>
                            {row.unit_ref && !ownerOpts.some(o => o.account_number === row.unit_ref) && row.unit_label && <option value={row.unit_ref}>{row.unit_label}</option>}
                            {ownerOpts.map(o => <option key={o.account_number} value={o.account_number}>{o.label}</option>)}
                          </select>
                        </Field>
                        {row.unit_label && !row.unit_ref && <p className="mt-1 text-[10px] text-gray-500">MAIA read: “{row.unit_label}” — pick the matching owner.</p>}
                      </div>
                    )}
                    {preview.has(row.id) && (
                      <div className="mt-2 overflow-hidden rounded border border-gray-200">
                        <iframe src={`/api/admin/documents/inbox/${row.id}`} title={`Preview ${row.filename ?? ''}`} className="h-[28rem] w-full bg-gray-50" />
                      </div>
                    )}
                    {row.err && <div className="mt-2 text-[11px] text-red-600">{row.err}</div>}
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button onClick={() => togglePreview(row.id)} className="mr-auto text-xs font-medium text-[#c2410c] hover:underline">{preview.has(row.id) ? 'Hide preview' : '👁 Preview document'}</button>
                      <a href={`/api/admin/documents/inbox/${row.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-gray-700">Open ↗</a>
                      {prev && <button onClick={() => mergePrev(row, prev)} disabled={row.busy} title={`Merge these pages into "${prev.doc_type ?? 'the previous document'}"`} className="text-xs text-blue-600 hover:underline">⤢ Append to previous</button>}
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
