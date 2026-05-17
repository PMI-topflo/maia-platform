'use client'

// =====================================================================
// /admin/cinc-sync/[code]/documents/DocumentsManager.tsx
//
// Phase 1 scope: upload PDFs for two governing documents per
// association — Condo Docs (Declaration) and Rules & Regulations.
// These are the files MAIA presents to new tenants / buyers during
// the application flow so they can read + e-sign acknowledgment.
//
// Drive-link and free-form note modes are intentionally hidden in
// the UI; the API still accepts them so we can add them back without
// a redeploy if the workflow expands.
// =====================================================================

import { useEffect, useState } from 'react'
import {
  CATEGORIES,
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

  // Group docs by category key. With just two categories the layout
  // stays flat — one section per category — instead of being nested
  // inside a group header (which made sense for the 28-category
  // version but is overkill now).
  const byCategory: Record<string, AssociationDocument[]> = {}
  for (const d of docs) {
    const key = d.category || 'other'
    if (!byCategory[key]) byCategory[key] = []
    byCategory[key].push(d)
  }

  return (
    <div className="space-y-6">
      <UploadCard assocCode={assocCode} onUploaded={refresh} />

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading documents…</div>}

      {!loading && CATEGORIES.map(cat => {
        const rows = byCategory[cat.key] ?? []
        return (
          <section key={cat.key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-700 [font-family:var(--font-mono)]">{cat.label}</h2>
              <span className="text-[10px] text-gray-400 uppercase font-mono">
                {rows.length === 0 ? 'No file yet' : `${rows.length} version${rows.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {rows.length === 0
              ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400">
                  Upload the current {cat.label.toLowerCase()} PDF above. Applicants will be required to acknowledge it before signing.
                </div>
              )
              : (
                <ul className="divide-y divide-gray-50">
                  {rows.map(d => (
                    <DocumentRow key={d.id} doc={d} assocCode={assocCode} onChanged={refresh} />
                  ))}
                </ul>
              )}
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
  const [category, setCategory] = useState<string>(CATEGORIES[0].key)
  const [notes, setNotes] = useState('')
  const [effective, setEffective] = useState('')
  const [filename, setFilename] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  function reset() {
    setNotes(''); setEffective(''); setFilename(''); setFile(null)
    setError(null); setOkMsg(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setOkMsg(null)
    try {
      if (!file) throw new Error('Pick a PDF to upload')
      const form = new FormData()
      form.append('file', file)
      form.append('category', category)
      if (notes)     form.append('notes', notes)
      if (effective) form.append('effective_date', effective)
      const res = await fetch(`/api/admin/associations/${assocCode}/documents`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Upload failed')
      setOkMsg(`Uploaded${data.pages ? ` (${data.pages} pages extracted)` : ''}.`)
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
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Upload a governing document</h3>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
          Applicants see these two documents during the new-tenant / new-buyer flow and must acknowledge them before signing. Uploading a newer version replaces nothing — the most recent file per category is what applicants see.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Document type</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            disabled={busy}
            className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] bg-white"
          >
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Effective date (optional)</span>
          <input
            type="date"
            value={effective}
            onChange={e => setEffective(e.target.value)}
            disabled={busy}
            className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b]"
          />
        </label>
      </div>

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
          PDF only. Max 50 MB. Files &lt; 20 MB are auto-extracted so MAIA can also cite from them when owners ask questions.
        </span>
      </label>

      <label className="block">
        <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Internal notes (optional)</span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={busy}
          rows={2}
          placeholder='Internal context, e.g. "Adopted at 2026 annual meeting"'
          className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b]"
        />
      </label>

      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {okMsg && <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{okMsg}</div>}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={busy}
          className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded transition-colors [font-family:var(--font-mono)]"
        >
          {busy ? 'Uploading & extracting…' : 'Upload'}
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
    <li className="flex items-start justify-between gap-3 text-xs px-4 py-3">
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
