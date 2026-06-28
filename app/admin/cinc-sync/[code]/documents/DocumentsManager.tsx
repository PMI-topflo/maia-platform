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

import { useEffect, useRef, useState } from 'react'
import {
  CATEGORIES,
  SUPPORTED_LANGUAGES,
  categoryLabel,
  languageLabel,
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
  // Per-category toggle for showing archived versions. Keyed by
  // category so opening history for Condo Docs doesn't also open it
  // for Rules (and vice versa).
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    // Always fetch with include_archived so the client has the full
    // history. We filter visually for "current" vs "previous" rather
    // than re-fetching when the user expands a history section.
    fetch(`/api/admin/associations/${assocCode}/documents?include_archived=1`)
      .then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b?.error ?? 'load failed') }))
      .then(data => { if (!cancelled) setDocs(data.documents ?? []) })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [assocCode, reloadKey])

  function refresh() { setReloadKey(k => k + 1) }

  // Partition by category, then by language, then current/archived.
  // Each (category, language) pair has its own current version + its
  // own history — so English Rules and Spanish Rules don't interact.
  type LangBucket = { current: AssociationDocument | null; previous: AssociationDocument[] }
  type CatBuckets = { perLanguage: Map<string, LangBucket>; allLanguages: string[] }
  const byCategory: Record<string, CatBuckets> = {}
  for (const cat of CATEGORIES) {
    const all = docs.filter(d => d.category === cat.key)
      .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
    const perLanguage = new Map<string, LangBucket>()
    for (const d of all) {
      const lang = d.language || 'en'
      const bucket = perLanguage.get(lang) ?? { current: null, previous: [] }
      if (!bucket.current && !d.archived_at) bucket.current = d
      else bucket.previous.push(d)
      perLanguage.set(lang, bucket)
    }
    // Sort languages by code so the listing is stable; English first
    // since it's the default + the only one applicants are guaranteed
    // to see (the apply step falls back to English when their lang
    // doesn't have a version).
    const allLanguages = [...perLanguage.keys()].sort((a, b) => a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b))
    byCategory[cat.key] = { perLanguage, allLanguages }
  }

  return (
    <div className="space-y-6">
      <UploadCard assocCode={assocCode} onUploaded={refresh} />

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading documents…</div>}

      {!loading && CATEGORIES.map(cat => {
        const { perLanguage, allLanguages } = byCategory[cat.key]
        return (
          <section key={cat.key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-700 [font-family:var(--font-mono)]">{cat.label}</h2>
              <span className="text-[10px] text-gray-400 uppercase font-mono">
                {allLanguages.length === 0
                  ? 'No file yet'
                  : `${allLanguages.length} language${allLanguages.length === 1 ? '' : 's'} uploaded`}
              </span>
            </div>
            {allLanguages.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-gray-400">
                Upload the current {cat.label.toLowerCase()} PDF above. Applicants will be required to acknowledge it before signing.
              </div>
            )}
            {allLanguages.map(lang => {
              const bucket = perLanguage.get(lang)!
              const historyKey = `${cat.key}:${lang}`
              const historyOpen = !!showHistory[historyKey]
              return (
                <div key={lang} className="border-t border-gray-100 first:border-t-0">
                  <div className="px-4 py-1.5 bg-indigo-50/50 flex items-baseline justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wide text-indigo-700">
                      🌐 {languageLabel(lang)}{lang === 'en' ? ' (default)' : ''}
                    </span>
                    <span className="text-[10px] font-mono uppercase text-indigo-500">
                      {bucket.current ? 'Current' : 'No current'}{bucket.previous.length > 0 ? ` · ${bucket.previous.length} prev` : ''}
                    </span>
                  </div>
                  {bucket.current && (
                    <ul className="divide-y divide-gray-50">
                      <DocumentRow doc={bucket.current} assocCode={assocCode} variant="current" onChanged={refresh} />
                    </ul>
                  )}
                  {bucket.previous.length > 0 && (
                    <div className="bg-gray-50/40">
                      <button
                        type="button"
                        onClick={() => setShowHistory(prev => ({ ...prev, [historyKey]: !historyOpen }))}
                        className="w-full px-4 py-2 text-[11px] font-mono uppercase tracking-wide text-gray-500 hover:text-gray-800 text-left"
                      >
                        {historyOpen ? '▾' : '▸'} {bucket.previous.length} previous {languageLabel(lang)} version{bucket.previous.length === 1 ? '' : 's'}
                      </button>
                      {historyOpen && (
                        <ul className="divide-y divide-gray-100">
                          {bucket.previous.map(d => (
                            <DocumentRow key={d.id} doc={d} assocCode={assocCode} variant="archived" onChanged={refresh} />
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}

      <TranslationsPreviewCard />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Upload / link / note form
// ─────────────────────────────────────────────────────────────────────

function UploadCard({ assocCode, onUploaded }: { assocCode: string; onUploaded: () => void }) {
  const [category, setCategory] = useState<string>(CATEGORIES[0].key)
  const [language, setLanguage] = useState<string>('en')
  const [notes, setNotes] = useState('')
  const [effective, setEffective] = useState('')
  const [filename, setFilename] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  // Ref to the hidden native <input type="file"> so the dropzone +
  // primary Upload button can both trigger the OS file picker
  // programmatically. Avoids relying on a label/htmlFor pairing.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function reset() {
    setNotes(''); setEffective(''); setFilename(''); setFile(null)
    setError(null); setOkMsg(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function openPicker() {
    if (busy) return
    fileInputRef.current?.click()
  }

  function acceptFile(f: File | null) {
    if (!f) return
    // PDF-only by category contract. Browsers honor `accept` for the
    // native picker but drag-and-drop bypasses it, so guard here too.
    if (!/pdf/i.test(f.type) && !/\.pdf$/i.test(f.name)) {
      setError('PDF only. Drop a .pdf file.')
      return
    }
    setError(null); setOkMsg(null)
    setFile(f)
    if (!filename) setFilename(f.name)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setOkMsg(null)
    try {
      if (!file) throw new Error('Pick a PDF to upload')

      // Three-step direct-upload flow. Bypasses Vercel's 4.5 MB
      // serverless body limit so 50 MB master policies / declaration
      // PDFs go straight from the browser to Supabase Storage.
      //
      // Step 1 — small POST: ask the server for a one-time signed
      // upload URL + token (staff auth happens here).
      const urlRes = await fetch(`/api/admin/associations/${assocCode}/documents/upload-url`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename: file.name, category, language }),
      })
      const urlData = await urlRes.json()
      if (!urlRes.ok) throw new Error(urlData?.error ?? 'Could not get upload URL')

      // Step 2 — direct browser → Supabase Storage upload via raw PUT
      // to the signed URL the server returned. We deliberately don't
      // go through supabase-js .uploadToSignedUrl() because that
      // helper has had path-handling regressions across versions; PUT
      // to the signed URL is the documented, stable path. NOT routed
      // through Vercel; no 4.5 MB body limit.
      const uploadRes = await fetch(urlData.signed_url, {
        method:  'PUT',
        body:    file,
        headers: {
          'Content-Type': file.type || 'application/pdf',
          // Tell Supabase Storage how to handle conflicts. The path
          // includes a timestamp + UUID so collisions are vanishingly
          // unlikely; "false" matches the createSignedUploadUrl
          // contract.
          'x-upsert':     'false',
        },
      })
      if (!uploadRes.ok) {
        // Read the response body for the real error message — Supabase
        // returns JSON like { statusCode, message, error }. Falls back
        // to the status line when the body isn't JSON.
        let detail = `HTTP ${uploadRes.status}`
        try {
          const j = await uploadRes.json() as { message?: string; error?: string }
          if (j?.message) detail = j.message
          else if (j?.error) detail = j.error
        } catch {
          const t = await uploadRes.text().catch(() => '')
          if (t) detail = t.slice(0, 200)
        }
        throw new Error(`Storage upload failed: ${detail}`)
      }

      // Step 3 — small POST: tell the server the upload completed so
      // it inserts the DB row, runs PDF extraction (downloading from
      // storage internally), and auto-archives the prior version.
      const metaRes = await fetch(`/api/admin/associations/${assocCode}/documents`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          source:           'upload_complete',
          storage_path:     urlData.storage_path,
          filename:         file.name,
          mime_type:        file.type || 'application/pdf',
          file_size_bytes:  file.size,
          category,
          language,
          notes:            notes || null,
          effective_date:   effective || null,
        }),
      })
      const metaData = await metaRes.json()
      if (!metaRes.ok) throw new Error(metaData?.error ?? 'Could not save metadata')

      setOkMsg(`Uploaded${metaData.pages ? ` (${metaData.pages} pages extracted)` : ''}.`)
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
          <span className="text-[10px] font-mono uppercase tracking-wide text-gray-600">Language</span>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            disabled={busy}
            className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] bg-white"
          >
            {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <span className="text-[10px] text-gray-500 block mt-0.5">
            Uploading a Spanish version of Rules doesn&apos;t archive the English one. Each language has its own version line.
          </span>
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

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wide text-gray-600 mb-1">PDF file</div>
        {/* Drop-zone: click anywhere on this box to open the OS file
            picker, OR drag a PDF in from Finder / Files. The native
            <input> is hidden but kept in the DOM so the form still has
            it for accessibility / accept-attribute validation. Once a
            file is picked, the box switches to a green "selected"
            state showing filename + size + a Change/Remove pair. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={e => acceptFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          className="hidden"
        />
        {file
          ? (
            <div className="mt-1 rounded border-2 border-green-500 bg-green-50 px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-green-900 truncate">📄 {file.name}</div>
                <div className="text-[11px] text-green-700 mt-0.5 font-mono">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · ready to upload
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={busy}
                  className="text-[10px] font-mono uppercase tracking-wide text-green-800 hover:text-green-900 border border-green-400 hover:border-green-600 rounded px-2 py-1"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  disabled={busy}
                  className="text-[10px] font-mono uppercase tracking-wide text-gray-500 hover:text-red-700 px-2 py-1"
                >
                  Remove
                </button>
              </div>
            </div>
          )
          : (
            <div
              role="button"
              tabIndex={0}
              onClick={openPicker}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker() } }}
              onDragOver={e => { e.preventDefault(); if (!dragging) setDragging(true) }}
              onDragEnter={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={e => { e.preventDefault(); setDragging(false) }}
              onDrop={e => {
                e.preventDefault()
                setDragging(false)
                acceptFile(e.dataTransfer.files?.[0] ?? null)
              }}
              className={[
                'mt-1 rounded border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors',
                dragging
                  ? 'border-[#f26a1b] bg-orange-50'
                  : 'border-gray-300 bg-gray-50 hover:border-[#f26a1b] hover:bg-orange-50',
                busy ? 'opacity-50 cursor-wait' : '',
              ].join(' ')}
            >
              <div className="text-3xl mb-2">📄</div>
              <div className="text-sm font-semibold text-gray-800">
                Click to choose a PDF, or drag one here
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                PDF only · max 50 MB · files &lt; 20 MB are auto-extracted so MAIA can cite them
              </div>
            </div>
          )}
      </div>

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

      <div className="flex items-center justify-end gap-2">
        {!file && !busy && (
          // Secondary path to the OS file picker when staff scrolls
          // straight to the bottom of the card without noticing the
          // drop zone above. Click yields the same OS file picker.
          <button
            type="button"
            onClick={openPicker}
            className="text-xs font-mono uppercase tracking-wide text-[#f26a1b] hover:text-[#c14d0a] border border-[#f26a1b] hover:bg-[#f26a1b]/10 px-4 py-2 rounded transition-colors"
          >
            Choose PDF
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !file}
          title={file ? '' : 'Choose a PDF first'}
          className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded transition-colors [font-family:var(--font-mono)]"
        >
          {busy ? 'Uploading & extracting…' : file ? `Upload "${file.name.length > 30 ? file.name.slice(0, 27) + '…' : file.name}"` : 'Upload'}
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Per-document row in the grouped list
// ─────────────────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  assocCode,
  variant,
  onChanged,
}: {
  doc:       AssociationDocument
  assocCode: string
  /** 'current' = the active version (full-color row, no archive label).
   *  'archived' = a previous version inside the history expander (muted
   *  styling, gets a "Make current" restore button). */
  variant:   'current' | 'archived'
  onChanged: () => void
}) {
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

  async function onArchive() {
    if (!confirm(`Archive "${doc.filename}"? It will move to "Previous versions" and stop appearing for applicants and owners until restored.`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/associations/${assocCode}/documents/${doc.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'archive' }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(`Archive failed: ${data?.error ?? res.status}`)
      return
    }
    onChanged()
  }

  async function onRestore() {
    if (!confirm(`Make "${doc.filename}" the current version? The existing current version will be archived.`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/associations/${assocCode}/documents/${doc.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'restore' }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(`Restore failed: ${data?.error ?? res.status}`)
      return
    }
    onChanged()
  }

  async function onTogglePublic() {
    const makePublic = !doc.is_public
    if (makePublic && !confirm(`Make "${doc.filename}" PUBLIC? It will be visible to ANYONE on the ${assocCode} page — no login required.`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/associations/${assocCode}/documents/${doc.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: makePublic ? 'set_public' : 'set_private' }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(`Update failed: ${data?.error ?? res.status}`)
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

  // Audit line — who uploaded + when, plus who archived + when if
  // applicable. Falls back to "system" when an action wasn't tied to
  // a logged-in staff email (e.g., auto-archive triggered by an API
  // call without a session — shouldn't happen today but defends).
  const uploadedAt = new Date(doc.created_at).toLocaleString()
  const archivedAt = doc.archived_at ? new Date(doc.archived_at).toLocaleString() : null

  return (
    <li className={`flex items-start justify-between gap-3 text-xs px-4 py-3 ${variant === 'archived' ? 'opacity-70' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpen}
            className="text-gray-900 hover:text-[#f26a1b] underline-offset-2 hover:underline truncate text-left font-medium"
          >
            {doc.filename}
          </button>
          {variant === 'current' && (
            <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono font-semibold uppercase bg-green-600 text-white">
              ✓ Current
            </span>
          )}
          {variant === 'archived' && (
            <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono uppercase bg-gray-200 text-gray-600">
              Archived
            </span>
          )}
          <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono uppercase ${statusStyles[doc.extraction_status] ?? 'bg-gray-100 text-gray-500'}`}>
            {doc.extraction_status}
          </span>
          {doc.is_public && variant === 'current' && (
            <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono font-semibold uppercase bg-blue-600 text-white">
              🌐 Public
            </span>
          )}
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
        {/* Audit trail: who uploaded + when, who archived + when */}
        <div className="text-[10px] text-gray-500 mt-1 font-mono">
          Uploaded by <span className="text-gray-700">{doc.uploaded_by_email ?? 'system'}</span> · {uploadedAt}
        </div>
        {archivedAt && (
          <div className="text-[10px] text-gray-500 font-mono">
            Archived by <span className="text-gray-700">{doc.archived_by_email ?? 'system'}</span> · {archivedAt}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap justify-end">
        {variant === 'archived' && (
          <button
            onClick={onRestore}
            disabled={busy}
            className="text-[10px] font-mono uppercase text-green-700 hover:text-green-900 px-1.5 py-0.5 rounded border border-green-300 hover:border-green-500"
          >
            {busy ? '…' : 'Make current'}
          </button>
        )}
        {variant === 'current' && (
          <button
            onClick={onTogglePublic}
            disabled={busy}
            className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${doc.is_public ? 'text-blue-700 border-blue-300 hover:border-blue-500' : 'text-gray-400 border-transparent hover:text-blue-700 hover:border-blue-200'}`}
            title={doc.is_public ? 'Visible to the public — click to make private' : 'Private — click to publish to the public page'}
          >
            {busy ? '…' : doc.is_public ? 'Make private' : 'Make public'}
          </button>
        )}
        {variant === 'current' && (
          <button
            onClick={onArchive}
            disabled={busy}
            className="text-[10px] font-mono uppercase text-gray-400 hover:text-amber-700 px-1.5 py-0.5 rounded border border-transparent hover:border-amber-200"
          >
            {busy ? '…' : 'Archive'}
          </button>
        )}
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

// ─────────────────────────────────────────────────────────────────────
// Translations preview
//
// Read-only card that shows how the apply-form's "Download & review
// these documents" prompt + button labels render in each of MAIA's
// six supported languages. Lets staff spot translation issues
// (typos, wrong tone, RTL layout bugs) without having to switch
// languages on the live form.
//
// Strings are duplicated here from components/ApplicationForm.tsx so
// this preview can render even if the form file is loaded lazily.
// When translations are edited, both places need updating — kept
// minimal so it stays in sync by inspection.
// ─────────────────────────────────────────────────────────────────────

interface LangPreview {
  code:        string
  label:       string
  title:       string
  opened:      string
  download:    string
  prompt:      string
  disclaimer?: string
  noticeLabel?: string
  rtl?:        boolean
}

const APPLY_STRINGS_PREVIEW: LangPreview[] = [
  { code: 'en', label: 'English',    title: 'Download & review these documents', opened: '✓ Opened', download: 'Download ↗', prompt: 'Please open all 2 documents before signing.' },
  { code: 'es', label: 'Español',    title: 'Descargue y revise estos documentos', opened: '✓ Abierto', download: 'Descargar ↗', prompt: 'Por favor abra los 2 documentos antes de firmar.',
    noticeLabel: 'Aviso de traducción',
    disclaimer: 'Este formulario de solicitud ha sido traducido para su conveniencia. La versión en inglés es la versión oficial de este acuerdo y de los documentos vinculados. Al firmar a continuación, usted acepta la versión en inglés. Si no entiende completamente la versión en inglés, busque asesoramiento profesional antes de firmar.' },
  { code: 'pt', label: 'Português',  title: 'Baixe e leia estes documentos', opened: '✓ Aberto', download: 'Baixar ↗', prompt: 'Por favor abra os 2 documentos antes de assinar.',
    noticeLabel: 'Aviso de tradução',
    disclaimer: 'Este formulário de solicitação foi traduzido para sua conveniência. A versão em inglês é a versão oficial deste acordo e dos documentos vinculados. Ao assinar abaixo, você concorda com a versão em inglês. Se você não entender completamente a versão em inglês, procure orientação profissional antes de assinar.' },
  { code: 'fr', label: 'Français',   title: 'Téléchargez et lisez ces documents', opened: '✓ Ouvert', download: 'Télécharger ↗', prompt: 'Veuillez ouvrir les 2 documents avant de signer.',
    noticeLabel: 'Avis de traduction',
    disclaimer: 'Ce formulaire de demande a été traduit pour votre commodité. La version anglaise est la version officielle de cet accord et des documents liés. En signant ci-dessous, vous acceptez la version anglaise. Si vous ne comprenez pas pleinement la version anglaise, veuillez consulter un conseil professionnel avant de signer.' },
  { code: 'he', label: 'עברית',      title: 'הורד וקרא את המסמכים האלה', opened: '✓ נפתח', download: 'הורד ↗', prompt: 'אנא פתח את כל 2 המסמכים לפני החתימה.', rtl: true,
    noticeLabel: 'הודעת תרגום',
    disclaimer: 'טופס בקשה זה תורגם לנוחיותך. הגרסה האנגלית היא הגרסה הרשמית של הסכם זה ושל המסמכים המקושרים. בחתימתך למטה, אתה מסכים לגרסה האנגלית. אם אינך מבין במלואה את הגרסה האנגלית, אנא פנה לייעוץ מקצועי לפני החתימה.' },
  { code: 'ru', label: 'Русский',    title: 'Скачайте и прочитайте эти документы', opened: '✓ Открыто', download: 'Скачать ↗', prompt: 'Пожалуйста, откройте все 2 документ перед подписанием.',
    noticeLabel: 'Уведомление о переводе',
    disclaimer: 'Эта форма заявки была переведена для вашего удобства. Английская версия является официальной версией этого соглашения и связанных документов. Подписывая ниже, вы соглашаетесь с английской версией. Если вы не полностью понимаете английскую версию, обратитесь за профессиональной консультацией перед подписанием.' },
]

function TranslationsPreviewCard() {
  return (
    <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-700 [font-family:var(--font-mono)]">Applicant-facing translations preview</h2>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
          How the &quot;Download &amp; review&quot; prompt + button labels appear to applicants in each language. To correct a string, edit the matching key in <code className="bg-gray-100 px-1 rounded font-mono">components/ApplicationForm.tsx</code> (look for <code className="bg-gray-100 px-1 rounded font-mono">docsReviewTitle</code>).
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {APPLY_STRINGS_PREVIEW.map(l => (
          <div key={l.code} className="px-4 py-3" dir={l.rtl ? 'rtl' : 'ltr'}>
            <div className={`flex items-baseline gap-2 mb-2 ${l.rtl ? 'flex-row-reverse' : ''}`}>
              <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono font-semibold uppercase bg-indigo-100 text-indigo-700">{l.code.toUpperCase()}</span>
              <span className="text-xs text-gray-700">{l.label}</span>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded p-3">
              <div className="text-[10px] font-mono uppercase tracking-wide text-orange-700 mb-2">{l.title}</div>
              <div className={`flex items-center gap-2 ${l.rtl ? 'flex-row-reverse' : ''}`}>
                <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-mono font-semibold bg-white border border-orange-300 text-orange-700">{l.download}</span>
                <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-mono font-semibold bg-green-50 border border-green-400 text-green-700">{l.opened}</span>
              </div>
              <div className="text-[11px] text-orange-700 mt-2">{l.prompt}</div>
              {l.disclaimer && (
                <div className="mt-3 p-2 bg-amber-50 border border-amber-300 rounded text-[11px] text-amber-900 leading-snug">
                  <div className="text-[9px] font-mono uppercase tracking-wide text-amber-800 mb-1">⚠ {l.noticeLabel}</div>
                  {l.disclaimer}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
