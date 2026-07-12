'use client'

// Drop-in replacement for a plain "download this document" link: instead
// of opening/downloading the raw PDF, it pops a modal showing the file
// rendered as inline page images. Used on the staff Applications
// dashboard and the board review page for signed documents, applicant
// uploads, and the Checkr report -- staff/board shouldn't have to
// download a PDF just to glance at it.
//
// `previewUrl` must resolve to JSON `{ pages: string[] }` -- either
// /api/document-preview?url=<stored file> or an application route's own
// ?preview=1 (e.g. the Rules Acknowledgment PDF, generated on the fly).
// `downloadUrl` (optional) is offered as a small secondary link inside
// the modal for anyone who still wants the actual file.

import { useState } from 'react'

export function DocumentPreviewTrigger({
  label, previewUrl, downloadUrl, className, style,
}: {
  label: string
  previewUrl: string
  downloadUrl?: string
  className?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function openPreview() {
    setOpen(true)
    if (pages !== null || error) return
    try {
      const res = await fetch(previewUrl)
      const d = await res.json()
      if (!res.ok || !d.pages?.length) { setError(d.error ?? 'No preview available.'); return }
      setPages(d.pages)
    } catch {
      setError('Could not load preview.')
    }
  }

  return (
    <>
      <button type="button" onClick={openPreview} className={className} style={{ cursor: 'pointer', ...style }}>
        {label}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(13,13,13,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, maxWidth: 760, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
          >
            <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '0.9rem 1.25rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0d0d0d' }}>{label}</span>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {downloadUrl && (
                  <a href={downloadUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem', color: '#f26a1b', fontWeight: 600, textDecoration: 'none' }}>
                    Download ↗
                  </a>
                )}
                <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.4rem', lineHeight: 1, cursor: 'pointer', color: '#6b7280', padding: 0 }}>×</button>
              </div>
            </div>
            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', minHeight: 120 }}>
              {pages === null && !error && <div style={{ fontSize: '0.85rem', color: '#6b7280', padding: '2rem 0' }}>Loading preview…</div>}
              {error && <div style={{ fontSize: '0.85rem', color: '#6b7280', padding: '2rem 0' }}>{error}</div>}
              {pages?.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt={`page ${i + 1}`} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid #e5e7eb' }} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
