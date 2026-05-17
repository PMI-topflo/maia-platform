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

  // Partition by category, then by current/archived. Each category
  // gets one "current" (newest non-archived) and N "previous" rows
  // (every other row in the same bucket, regardless of archive flag —
  // a stray active row would also surface in history so staff can
  // spot the anomaly).
  const byCategory: Record<string, { current: AssociationDocument | null; previous: AssociationDocument[] }> = {}
  for (const cat of CATEGORIES) {
    const all = docs.filter(d => d.category === cat.key)
      .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
    const current = all.find(d => !d.archived_at) ?? null
    const previous = all.filter(d => d.id !== current?.id)
    byCategory[cat.key] = { current, previous }
  }

  return (
    <div className="space-y-6">
      <UploadCard assocCode={assocCode} onUploaded={refresh} />

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading documents…</div>}

      {!loading && CATEGORIES.map(cat => {
        const { current, previous } = byCategory[cat.key]
        const historyOpen = !!showHistory[cat.key]
        return (
          <section key={cat.key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-700 [font-family:var(--font-mono)]">{cat.label}</h2>
              <span className="text-[10px] text-gray-400 uppercase font-mono">
                {!current
                  ? 'No current version'
                  : `Current + ${previous.length} previous version${previous.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {current
              ? (
                <ul className="divide-y divide-gray-50">
                  <DocumentRow doc={current} assocCode={assocCode} variant="current" onChanged={refresh} />
                </ul>
              )
              : (
                <div className="px-4 py-6 text-center text-xs text-gray-400">
                  Upload the current {cat.label.toLowerCase()} PDF above. Applicants will be required to acknowledge it before signing.
                </div>
              )}
            {previous.length > 0 && (
              <div className="border-t border-gray-100 bg-gray-50/40">
                <button
                  type="button"
                  onClick={() => setShowHistory(prev => ({ ...prev, [cat.key]: !historyOpen }))}
                  className="w-full px-4 py-2 text-[11px] font-mono uppercase tracking-wide text-gray-500 hover:text-gray-800 text-left"
                >
                  {historyOpen ? '▾' : '▸'} {previous.length} previous version{previous.length === 1 ? '' : 's'}
                </button>
                {historyOpen && (
                  <ul className="divide-y divide-gray-100">
                    {previous.map(d => (
                      <DocumentRow key={d.id} doc={d} assocCode={assocCode} variant="archived" onChanged={refresh} />
                    ))}
                  </ul>
                )}
              </div>
            )}
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
  code:  string
  label: string
  title: string
  opened: string
  download: string
  prompt: string
  rtl?:  boolean
}

const APPLY_STRINGS_PREVIEW: LangPreview[] = [
  { code: 'en', label: 'English',    title: 'Download & review these documents', opened: '✓ Opened', download: 'Download ↗', prompt: 'Please open all 2 documents before signing.' },
  { code: 'es', label: 'Español',    title: 'Descargue y revise estos documentos', opened: '✓ Abierto', download: 'Descargar ↗', prompt: 'Por favor abra los 2 documentos antes de firmar.' },
  { code: 'pt', label: 'Português',  title: 'Baixe e leia estes documentos', opened: '✓ Aberto', download: 'Baixar ↗', prompt: 'Por favor abra os 2 documentos antes de assinar.' },
  { code: 'fr', label: 'Français',   title: 'Téléchargez et lisez ces documents', opened: '✓ Ouvert', download: 'Télécharger ↗', prompt: 'Veuillez ouvrir les 2 documents avant de signer.' },
  { code: 'he', label: 'עברית',      title: 'הורד וקרא את המסמכים האלה', opened: '✓ נפתח', download: 'הורד ↗', prompt: 'אנא פתח את כל 2 המסמכים לפני החתימה.', rtl: true },
  { code: 'ru', label: 'Русский',    title: 'Скачайте и прочитайте эти документы', opened: '✓ Открыто', download: 'Скачать ↗', prompt: 'Пожалуйста, откройте все 2 документ перед подписанием.' },
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
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
