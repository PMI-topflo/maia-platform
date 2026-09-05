'use client'

// Public, token-gated (the applications row id IS the token — same
// convention as /rescreen/[token]). Lets a PAID /apply-wizard applicant add
// more documents afterward, without reopening the wizard or risking a
// second payment. See app/api/apply/documents/[id]/route.ts for the API
// this talks to, and its header comment for why this is a standalone page
// rather than reusing the newer /pre-apply system's /request/[token].

import { useEffect, useState, use as usePromise } from 'react'

interface Doc { filename: string; label: string | null; uploaded_at: string; url: string | null }

export default function ApplyDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [association, setAssociation] = useState('')
  const [refNum, setRefNum] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/apply/documents/${id}`)
        const d = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(d.error ?? 'This link is invalid.'); return }
        setAssociation(d.association); setRefNum(d.refNum); setDocs(d.documents ?? [])
      } catch { if (!cancelled) setError('Could not load this page. Please try again.') }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [id])

  async function upload() {
    if (!file) return
    setUploading(true); setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (label.trim()) fd.append('label', label.trim())
      const res = await fetch(`/api/apply/documents/${id}`, { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) { setUploadError(d.error ?? 'Upload failed.'); return }
      setDocs(d.documents ?? []); setFile(null); setLabel('')
    } catch { setUploadError('Network error — please try again.') }
    setUploading(false)
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
  const card: React.CSSProperties = { background: '#fff', borderRadius: 8, maxWidth: 560, width: '100%', padding: '48px 44px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }

  if (loading) return <div style={wrap}><div style={{ color: '#fff', fontSize: 14 }}>Loading…</div></div>
  if (error) return (
    <div style={wrap}><div style={card}>
      <p style={{ fontSize: 12, fontWeight: 700, color: '#f26a1b', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 12px' }}>PMI Top Florida Properties</p>
      <p style={{ fontSize: 14, color: '#3a3f4a' }}>{error}</p>
    </div></div>
  )

  return (
    <div style={wrap}>
      <div style={card}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#f26a1b', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 8px' }}>PMI Top Florida Properties</p>
        <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 24, color: '#0d0d0d', margin: '0 0 6px' }}>Add More Documents</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 4px' }}>{association} · Reference {refNum}</p>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 28px' }}>Your payment is confirmed. If you have anything else to add to your application — a corrected document, a form the board asked for — you can upload it here at any time.</p>

        {docs.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 10px' }}>Already uploaded</p>
            {docs.map((d, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                <span style={{ color: '#374151' }}>{d.label || d.filename}</span>
                {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: '#f26a1b', fontWeight: 600, textDecoration: 'none', fontSize: 12 }}>View ↗</a>}
              </div>
            ))}
          </div>
        )}

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>What is this document? (optional)</label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Updated pay stub"
            style={{ width: '100%', padding: '9px 11px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 4, boxSizing: 'border-box', marginBottom: 14 }} />
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 13, marginBottom: 14 }} />
          {uploadError && <p style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 12px' }}>⚠ {uploadError}</p>}
          <button onClick={upload} disabled={!file || uploading}
            style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 700, color: '#fff', background: (!file || uploading) ? '#9ca3af' : '#0d0d0d', border: 'none', borderRadius: 4, cursor: (!file || uploading) ? 'default' : 'pointer' }}>
            {uploading ? 'Uploading…' : 'Upload Document'}
          </button>
        </div>

        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 24 }}>
          Questions? Email us at <a href="mailto:support@topfloridaproperties.com" style={{ color: '#f26a1b', fontWeight: 600 }}>support@topfloridaproperties.com</a>
        </p>
      </div>
    </div>
  )
}
