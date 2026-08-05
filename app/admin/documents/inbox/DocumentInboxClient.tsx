'use client'

// =====================================================================
// DocumentInboxClient.tsx — bulk upload → MAIA classifies → review queue.
// One uploaded file = one card, never split apart. MAIA suggests every
// compliance item the document satisfies as a checklist; staff check/
// uncheck, adjust dates per item, add anything MAIA missed, and file once
// — writing one compliance_records row per checked item, all pointing at
// the same undivided document. Association AND unit/owner scope: unit-
// level docs (lease, HO-6, registrations…) also pick the owner.
// =====================================================================

import { useEffect, useState } from 'react'
import { COMPLIANCE_TAXONOMY } from '@/lib/compliance-taxonomy'
import DriveImport from './DriveImport'

const isExpired = (d: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < new Date().toISOString().slice(0, 10)

export interface AssocOpt { code: string; name: string }
interface OwnerOpt { account_number: string; label: string }
interface CustomReq { association_code: string; item_key: string; label: string }

const CATS = COMPLIANCE_TAXONOMY
const itemLabel = (key: string) => CATS.flatMap(c => c.items).find(i => i.key === key)?.label ?? key
const confBadge = (c: number) => c >= 0.8 ? 'bg-emerald-100 text-emerald-800' : c >= 0.5 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'
const uid = () => Math.random().toString(36).slice(2)

interface Tag {
  uid: string; itemKey: string; docType: string | null
  effectiveDate: string; expirationDate: string; confidence: number; checked: boolean
}
interface Row {
  id: string; filename: string | null; summary: string | null; model: string | null
  association_code: string; scope: 'association' | 'unit'
  unit_ref: string; unit_label: string | null
  tags: Tag[]
  busy?: boolean; err?: string | null
}

interface RawSuggestedItem {
  item_key: string | null; category: string | null; doc_type: string | null
  effective_date: string | null; expiration_date: string | null; confidence: number | null
}
interface RawRow {
  id: string; filename: string | null; summary: string | null; doc_type: string | null
  confidence: number | null; model: string | null
  suggested_association_code: string | null; suggested_category: string | null; suggested_item_key: string | null
  suggested_scope: string | null; suggested_unit_ref: string | null; suggested_unit_label: string | null
  suggested_items: RawSuggestedItem[] | null
  effective_date: string | null; expiration_date: string | null
}

function toRow(r: RawRow): Row {
  const scope: 'association' | 'unit' = r.suggested_scope === 'unit' ? 'unit' : 'association'
  const raw: RawSuggestedItem[] = Array.isArray(r.suggested_items) && r.suggested_items.length > 0
    ? r.suggested_items
    : (r.suggested_item_key
        ? [{ item_key: r.suggested_item_key, category: r.suggested_category, doc_type: r.doc_type, effective_date: r.effective_date, expiration_date: r.expiration_date, confidence: r.confidence }]
        : [])
  const tags: Tag[] = raw.filter(it => it.item_key).map(it => ({
    uid: uid(), itemKey: it.item_key as string, docType: it.doc_type,
    effectiveDate: it.effective_date ?? '', expirationDate: it.expiration_date ?? '',
    confidence: it.confidence ?? 0, checked: true,
  }))
  return {
    id: r.id, filename: r.filename, summary: r.summary, model: r.model,
    association_code: r.suggested_association_code ?? '', scope,
    unit_ref: r.suggested_unit_ref ?? '', unit_label: r.suggested_unit_label,
    tags,
  }
}

export default function DocumentInboxClient({ associations }: { associations: AssocOpt[] }) {
  const [rows, setRows] = useState<Row[]>([])
  const [owners, setOwners] = useState<Record<string, OwnerOpt[]>>({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Set<string>>(new Set())
  const [customReqs, setCustomReqs] = useState<CustomReq[]>([])

  function togglePreview(id: string) {
    setPreview(p => { const s = new Set(p); if (s.has(id)) s.delete(id); else s.add(id); return s })
  }

  // Custom per-association unit requirements (/admin/association-document-setup,
  // e.g. City of Lauderhill's Certificate of Use) merge into the "add item"
  // list, scoped to whichever association a row has selected.
  useEffect(() => {
    fetch('/api/admin/association-document-requirements').then(r => r.json()).then(d => setCustomReqs(d.requirements ?? [])).catch(() => null)
  }, [])

  /** Items available to add to a row, grouped by category, for its scope. */
  function addableItems(row: Row): { category: string; items: { key: string; label: string }[] }[] {
    const cats = CATS.filter(c => c.scope === row.scope)
    const groups = cats.map(c => ({ category: c.label, items: c.items.map(i => ({ key: i.key, label: i.label })) }))
    if (row.scope === 'unit' && row.association_code) {
      const custom = customReqs.filter(r => r.association_code === row.association_code).map(r => ({ key: r.item_key, label: `${r.label} (custom)` }))
      if (custom.length > 0) groups.push({ category: 'Custom for this association', items: custom })
    }
    return groups
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
        for (const r of mapped) if (r.scope === 'unit' && r.association_code) ensureOwners(r.association_code)
      })
      .catch(() => {}).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patch(id: string, p: Partial<Row>) { setRows(rs => rs.map(r => r.id === id ? { ...r, ...p } : r)) }
  function patchTag(rowId: string, tagUid: string, p: Partial<Tag>) {
    setRows(rs => rs.map(r => r.id !== rowId ? r : { ...r, tags: r.tags.map(t => t.uid === tagUid ? { ...t, ...p } : t) }))
  }
  function addTag(rowId: string, itemKey: string) {
    if (!itemKey) return
    setRows(rs => rs.map(r => r.id !== rowId ? r : { ...r, tags: [...r.tags, { uid: uid(), itemKey, docType: null, effectiveDate: '', expirationDate: '', confidence: 1, checked: true }] }))
  }
  function removeTag(rowId: string, tagUid: string) {
    setRows(rs => rs.map(r => r.id !== rowId ? r : { ...r, tags: r.tags.filter(t => t.uid !== tagUid) }))
  }

  function onDriveImported(raws: unknown[]) {
    const newRows = (raws as RawRow[]).map(toRow)
    if (newRows.length === 0) return
    setRows(rs => [...newRows, ...rs])
    for (const row of newRows) if (row.scope === 'unit' && row.association_code) ensureOwners(row.association_code)
  }

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
        const newRows = ((ex.rows ?? (ex.row ? [ex.row] : [])) as RawRow[]).map(toRow)
        setRows(rs => [...newRows, ...rs])
        for (const row of newRows) if (row.scope === 'unit' && row.association_code) ensureOwners(row.association_code)
      } catch (e) { setError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
      setUploading({ done: i + 1, total: list.length })
    }
    setUploading(null)
  }

  async function apply(row: Row) {
    const checked = row.tags.filter(t => t.checked && t.itemKey)
    if (!row.association_code) { patch(row.id, { err: 'Pick an association first.' }); return }
    if (checked.length === 0) { patch(row.id, { err: 'Check at least one item this document satisfies.' }); return }
    if (row.scope === 'unit' && !row.unit_ref) { patch(row.id, { err: 'Pick the owner/unit this belongs to.' }); return }
    patch(row.id, { busy: true, err: null })
    try {
      const res = await fetch(`/api/admin/documents/inbox/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply', scope: row.scope, association_code: row.association_code, unit_ref: row.unit_ref || null,
          items: checked.map(t => ({ item_key: t.itemKey, effective_date: t.effectiveDate || null, expiration_date: t.expirationDate || null })),
        }) })
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
      <div className="mb-3"><DriveImport onImported={onDriveImported} /></div>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#f26a1b]/40 bg-[#fff8f4] px-6 py-8 text-center hover:border-[#f26a1b]">
        <input type="file" accept="application/pdf,image/*" multiple className="hidden" disabled={uploading !== null} onChange={e => onFiles(e.target.files)} />
        <span className="text-sm font-medium text-gray-800">{uploading ? `MAIA is reading… ${uploading.done}/${uploading.total}` : '📥 Drop PDFs here or click to upload (multiple OK)'}</span>
        <span className="mt-1 text-xs text-gray-500">MAIA reads each and suggests the association, the owner/unit (for unit docs), and every compliance item it satisfies — one document can cover several.</span>
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
                const isUnit = row.scope === 'unit'
                const ownerOpts = owners[row.association_code] ?? []
                const anyExpired = row.tags.some(t => isExpired(t.expirationDate))
                return (
                  <div key={row.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{row.filename ?? 'document'}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isUnit ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>{isUnit ? 'Unit / owner' : 'Association'}</span>
                        {anyExpired && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">⚠ has an expired item</span>}
                        {row.model && <span className="text-[10px] text-gray-400">{row.model}</span>}
                      </div>
                    </div>
                    {row.summary && <p className="mb-2 text-xs text-gray-500">MAIA: {row.summary}</p>}

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Field label={`Association${assocMissing ? ' — pick' : ''}`}>
                        <select value={row.association_code} onChange={e => { patch(row.id, { association_code: e.target.value, unit_ref: '', err: null }); if (row.scope === 'unit') ensureOwners(e.target.value) }}
                          className={`w-full rounded border px-1.5 py-1 text-[11px] ${assocMissing ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
                          <option value="">— select —</option>
                          {associations.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
                        </select>
                      </Field>
                      <Field label="Scope">
                        <select value={row.scope} onChange={e => { const scope = e.target.value === 'unit' ? 'unit' : 'association'; patch(row.id, { scope, unit_ref: '' }); if (scope === 'unit' && row.association_code) ensureOwners(row.association_code) }}
                          className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]">
                          <option value="association">Association-wide</option>
                          <option value="unit">Unit / owner</option>
                        </select>
                      </Field>
                      {isUnit && (
                        <Field label={`Owner / unit${row.unit_ref ? '' : ' — pick'}`}>
                          <select value={row.unit_ref} onChange={e => patch(row.id, { unit_ref: e.target.value, err: null })}
                            disabled={!row.association_code}
                            className={`w-full rounded border px-1.5 py-1 text-[11px] ${!row.unit_ref ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
                            <option value="">{!row.association_code ? 'pick an association first' : ownerOpts.length ? '— select owner —' : 'loading owners…'}</option>
                            {row.unit_ref && !ownerOpts.some(o => o.account_number === row.unit_ref) && row.unit_label && <option value={row.unit_ref}>{row.unit_label}</option>}
                            {ownerOpts.map(o => <option key={o.account_number} value={o.account_number}>{o.label}</option>)}
                          </select>
                        </Field>
                      )}
                    </div>
                    {isUnit && row.unit_label && !row.unit_ref && <p className="mt-1 text-[10px] text-gray-500">MAIA read: “{row.unit_label}” — pick the matching owner.</p>}

                    <div className="mt-3 space-y-1.5">
                      <div className="text-[9px] uppercase tracking-wide text-gray-400">This document satisfies</div>
                      {row.tags.length === 0 && <p className="text-xs text-gray-400">MAIA didn’t detect an item — add one below.</p>}
                      {row.tags.map(t => (
                        <div key={t.uid} className="flex flex-wrap items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
                          <input type="checkbox" checked={t.checked} onChange={e => patchTag(row.id, t.uid, { checked: e.target.checked })} />
                          <span className="min-w-[10rem] flex-1 text-xs text-gray-800">{itemLabel(t.itemKey)}{t.docType ? <span className="text-gray-400"> — {t.docType}</span> : null}</span>
                          {t.confidence > 0 && <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confBadge(t.confidence)}`}>{Math.round(t.confidence * 100)}%</span>}
                          <input type="date" value={t.effectiveDate} onChange={e => patchTag(row.id, t.uid, { effectiveDate: e.target.value })} placeholder="Effective" className="rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
                          <input type="date" value={t.expirationDate} onChange={e => patchTag(row.id, t.uid, { expirationDate: e.target.value })} placeholder="Expiration" className={`rounded border px-1.5 py-1 text-[11px] ${isExpired(t.expirationDate) ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} />
                          <button onClick={() => removeTag(row.id, t.uid)} className="text-xs text-gray-400 hover:text-red-600">✕</button>
                        </div>
                      ))}
                      <select value="" onChange={e => addTag(row.id, e.target.value)} className="w-full rounded border border-dashed border-gray-300 px-1.5 py-1 text-[11px] text-gray-500">
                        <option value="">+ Add another item…</option>
                        {addableItems(row).map(g => (
                          <optgroup key={g.category} label={g.category}>
                            {g.items.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {preview.has(row.id) && (
                      <div className="mt-2 overflow-hidden rounded border border-gray-200">
                        <iframe src={`/api/admin/documents/inbox/${row.id}`} title={`Preview ${row.filename ?? ''}`} className="h-[28rem] w-full bg-gray-50" />
                      </div>
                    )}
                    {row.err && <div className="mt-2 text-[11px] text-red-600">{row.err}</div>}
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button onClick={() => togglePreview(row.id)} className="mr-auto text-xs font-medium text-[#c2410c] hover:underline">{preview.has(row.id) ? 'Hide preview' : '👁 Preview document'}</button>
                      <a href={`/api/admin/documents/inbox/${row.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-gray-700">Open ↗</a>
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
