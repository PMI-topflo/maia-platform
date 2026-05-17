'use client'

// =====================================================================
// /admin/cinc-sync/[code]/documents/DocumentsManager.tsx
//
// Interactive document library for one association. Three input modes:
//
//   1. Upload a PDF — multipart POST, server extracts text inline
//   2. Add a Drive link — JSON POST with the URL
//   3. Add a note — JSON POST with free-form text (useful for facts
//      that don't have a file yet: "Pool resurfaced May 2026, warranty
//      until 2028")
//
// The list groups documents by category (governance / financial /
// insurance / Florida safety / vendors / other) so staff can see at
// a glance which categories are covered and which still need attention.
// =====================================================================

import { useEffect, useState } from 'react'
import {
  CATEGORIES,
  categoriesByGroup,
  categoryLabel,
  type AssociationDocument,
} from '@/lib/association-documents'

interface Props {
  assocCode: string
}

export default function DocumentsManager({ assocCode }: Props) {
  const [docs, setDocs] = useState<AssociationDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/admin/associations/${assocCode}/documents`)
      .then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b?.error ?? 'load failed') }))
      .then(data => { if (!cancelled) setDocs(data.documents ?? []) })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [assocCode, reloadKey])

  function refresh() { setReloadKey(k => k + 1) }

  // Group docs by category key for the grouped display.
  const byCategory: Record<string, AssociationDocument[]> = {}
  for (const d of docs) {
    const key = d.category || 'other'
    if (!byCategory[key]) byCategory[key] = []
    byCategory[key].push(d)
  }
  const groups = categoriesByGroup()

  return (
    <div className="space-y-6">
      <UploadCard assocCode={assocCode} onUploaded={refresh} />

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading documents…</div>}

      {!loading && groups.map(({ group, items }) => {
        const hasAny = items.some(c => (byCategory[c.key]?.length ?? 0) > 0)
        return (
          <section key={group} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-baseline justify-between">
              <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide [font-family:var(--font-mono)]">{group}</h2>
              {!hasAny && <span className="text-[10px] text-gray-400 uppercase font-mono">No documents yet</span>}
            </div>
            <div className="divide-y divide-gray-50">
              {items.map(cat => {
                const rows = byCategory[cat.key] ?? []
                if (rows.length === 0) {
                  return (
                    <div key={cat.key} className="px-4 py-2 flex items-center justify-between text-xs">
                      <span className="text-gray-500">{cat.label}</span>
                      <span className="text-gray-300 font-mono uppercase">empty</span>
                    </div>
                  )
                }
                return (
                  <div key={cat.key} className="px-4 py-3">
                    <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <span>{cat.label}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{rows.length} item{rows.length === 1 ? '' : 's'}</span>
                    </div>
                    <ul className="space-y-1.5">
                      {rows.map(d => (
                        <DocumentRow key={d.id} doc={d} assocCode={assocCode} onChanged={refresh} />
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Upload / link / note form
// ─────────────────────────────────────────────────────────────────────

function UploadCard({ assocCode, onUploaded }: { assocCode: string; onUploaded: () => void }) {
  const [mode, setMode] = useState<'upload' | 'drive_link' | 'note'>('upload')
  const [category, setCategory] = useState<string>(CATEGORIES[0].key)
  const [subcategory, setSubcategory] = useState('')
  const [notes, setNotes] = useState('')
  const [effective, setEffective] = useState('')
  const [expiry, setExpiry] = useState('')
  const [driveUrl, setDriveUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const isDated = !!CATEGORIES.find(c => c.key === category)?.dated

  function reset() {
    setSubcategory(''); setNotes(''); setEffective(''); setExpiry('')
    setDriveUrl(''); setFilename(''); setFile(null)
    setError(null); setOkMsg(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setOkMsg(null)
    try {
      let res: Response
      if (mode === 'upload') {
        if (!file) throw new Error('Pick a file to upload')
        const form = new FormData()
        form.append('file', file)
        form.append('category', category)
        if (subcategory) form.append('subcategory', subcategory)
        if (notes)       form.append('notes', notes)
        if (effective)   form.append('effective_date', effective)
        if (expiry)      form.append('expiry_date', expiry)
        res = await fetch(`/api/admin/associations/${assocCode}/documents`, { method: 'POST', body: form })
      } else {
        const body = {
          source:         mode,
          category,
          subcategory:    subcategory || null,
          drive_url:      mode === 'drive_link' ? driveUrl : null,
          filename:       filename || (mode === 'drive_link' ? 'Drive link' : 'Note'),
          notes:          notes || null,
          effective_date: effective || null,
          expiry_date:    expiry || null,
        }
        res = await fetch(`/api/admin/associations/${assocCode}/documents`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      setOkMsg(mode === 'upload'
        ? `Uploaded${data.pages ? ` (${data.pages} pages extracted)` : ''}.`
        : 'Saved.')
      reset()
      onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-1 flex-wrap">
        {(['upload', 'drive_link', 'note'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={[
              'text-[10px] font-mono uppercase tracking-wide px-2.5 py-1 rounded transition-colors',
              mode === m
                ? 'bg-[#f26a1b] text-white'
                : 'text-gray-500 hover:text-gray-800 border border-gray-300',
            ].join(' ')}
          >
            {m === 'upload' ? 'Upload PDF' : m === 'drive_link' ? 'Add Drive link' : 'Add note'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block md:col-span-1">
          <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Category</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            disabled={busy}
            className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] bg-white"
          >
            {categoriesByGroup().map(({ group, items }) => (
              <optgroup key={group} label={group}>
                {items.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Subcategory (optional)</span>
          <input
            type="text"
            value={subcategory}
            onChange={e => setSubcategory(e.target.value)}
            disabled={busy}
            placeholder="e.g. carrier name, vendor name, policy #"
            className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b]"
          />
        </label>
      </div>

      {mode === 'upload' && (
        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">PDF file</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={e => {
              const f = e.target.files?.[0] ?? null
              setFile(f)
              if (f && !filename) setFilename(f.name)
            }}
            disabled={busy}
            className="mt-1 block text-sm"
          />
          <span className="text-[10px] text-gray-500 block mt-0.5">
            Max 50 MB. PDFs &lt; 20 MB get text-extracted automatically; larger ones upload but staff need to add a notes summary for MAIA.
          </span>
        </label>
      )}

      {mode === 'drive_link' && (
        <>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Drive URL</span>
            <input
              type="url"
              value={driveUrl}
              onChange={e => setDriveUrl(e.target.value)}
              disabled={busy}
              required
              placeholder="https://drive.google.com/..."
              className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Display name (optional)</span>
            <input
              type="text"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              disabled={busy}
              placeholder="e.g. 2026 Wind Policy — Citizens"
              className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b]"
            />
          </label>
        </>
      )}

      <label className="block">
        <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">
          Notes / summary {mode === 'note' && <span className="text-red-600">(required)</span>}
        </span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={busy}
          rows={mode === 'note' ? 4 : 2}
          required={mode === 'note'}
          placeholder={mode === 'note'
            ? 'Free-form fact MAIA can cite (e.g. "Pool resurfaced May 2026, 2-year warranty")'
            : 'One-liner for context (e.g. "Renews Aug 2026, contact agent X")'}
          className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b]"
        />
      </label>

      {isDated && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Effective date</span>
            <input
              type="date"
              value={effective}
              onChange={e => setEffective(e.target.value)}
              disabled={busy}
              className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Expiry date</span>
            <input
              type="date"
              value={expiry}
              onChange={e => setExpiry(e.target.value)}
              disabled={busy}
              className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b]"
            />
          </label>
        </div>
      )}

      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {okMsg && <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{okMsg}</div>}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={busy}
          className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded transition-colors [font-family:var(--font-mono)]"
        >
          {busy
            ? (mode === 'upload' ? 'Uploading & extracting…' : 'Saving…')
            : (mode === 'upload' ? 'Upload' : 'Save')}
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Per-document row in the grouped list
// ─────────────────────────────────────────────────────────────────────

function DocumentRow({ doc, assocCode, onChanged }: { doc: AssociationDocument; assocCode: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)

  async function onDelete() {
    if (!confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/associations/${assocCode}/documents/${doc.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(`Delete failed: ${data?.error ?? res.status}`)
      return
    }
    onChanged()
  }

  async function onOpen() {
    const res = await fetch(`/api/admin/associations/${assocCode}/documents/${doc.id}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(`Open failed: ${data?.error ?? res.status}`)
      return
    }
    const data = await res.json()
    if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer')
  }

  // Status chip styles so staff can scan extraction state at a glance.
  const statusStyles: Record<string, string> = {
    done:        'bg-green-100 text-green-700',
    extracting:  'bg-blue-100 text-blue-700',
    pending:     'bg-gray-100 text-gray-500',
    failed:      'bg-red-100 text-red-700',
    skipped:     'bg-amber-100 text-amber-800',
    unsupported: 'bg-gray-100 text-gray-500',
  }

  return (
    <li className="flex items-start justify-between gap-3 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpen}
            className="text-gray-900 hover:text-[#f26a1b] underline-offset-2 hover:underline truncate text-left"
          >
            {doc.filename}
          </button>
          <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono uppercase ${statusStyles[doc.extraction_status] ?? 'bg-gray-100 text-gray-500'}`}>
            {doc.extraction_status}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wide text-gray-400">
            {doc.source === 'upload' ? 'file' : doc.source === 'drive_link' ? 'drive' : 'note'}
          </span>
          {doc.expiry_date && (
            <span className="text-[10px] font-mono text-amber-700">
              expires {doc.expiry_date}
            </span>
          )}
        </div>
        {(doc.subcategory || doc.notes) && (
          <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">
            {doc.subcategory && <span className="font-medium text-gray-700">{doc.subcategory}</span>}
            {doc.subcategory && doc.notes && ' · '}
            {doc.notes}
          </div>
        )}
        <div className="text-[10px] text-gray-400 mt-0.5 font-mono">
          {categoryLabel(doc.category)}
          {doc.file_size_bytes ? ` · ${(doc.file_size_bytes / 1024 / 1024).toFixed(2)} MB` : ''}
          {doc.effective_date ? ` · effective ${doc.effective_date}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onDelete}
          disabled={busy}
          className="text-[10px] font-mono uppercase text-gray-400 hover:text-red-700 px-1.5 py-0.5 rounded border border-transparent hover:border-red-200"
        >
          {busy ? '…' : 'Delete'}
        </button>
      </div>
    </li>
  )
}
