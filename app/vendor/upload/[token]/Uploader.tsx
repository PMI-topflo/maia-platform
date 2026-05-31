'use client'

import { useState } from 'react'

const CATEGORIES = [
  { key: 'estimate', label: 'Estimate' },
  { key: 'invoice',  label: 'Invoice' },
  { key: 'photos',   label: 'Job photos' },
] as const

export default function Uploader({ token }: { token: string }) {
  const [category, setCategory]    = useState<string>('estimate')
  const [files, setFiles]          = useState<File[]>([])
  const [report, setReport]        = useState('')
  const [suggestions, setSuggestions] = useState('')
  const [busy, setBusy]            = useState(false)
  const [done, setDone]            = useState<string | null>(null)
  const [error, setError]          = useState<string | null>(null)

  // Photos really need a report; estimates/invoices can carry a short note.
  const reportLabel = category === 'photos'
    ? 'Brief report — what work was done?'
    : 'Note (optional)'

  async function submit() {
    if (!files.length) { setError('Choose at least one file.'); return }
    if (category === 'photos' && !report.trim()) { setError('Please add a brief report of the work done.'); return }
    setBusy(true); setError(null); setDone(null)
    try {
      const fd = new FormData()
      fd.set('category', category)
      fd.set('report', report)
      fd.set('suggestions', suggestions)
      files.forEach(f => fd.append('files', f))
      const res = await fetch(`/api/vendor/upload/${token}`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error ?? `Upload failed (${res.status})`)
      setDone(`Thank you — ${j.saved ?? files.length} file(s) received. PMI has been notified.`)
      setFiles([]); setReport(''); setSuggestions('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46' }}>
        ✓ {done}
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setDone(null)} style={linkBtn}>Upload more</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)} style={{
            padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: category === c.key ? '1px solid #f26a1b' : '1px solid #d1d5db',
            background: category === c.key ? '#fff7ed' : '#fff',
            color: category === c.key ? '#c2410c' : '#374151',
          }}>{c.label}</button>
        ))}
      </div>

      <input
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*"
        onChange={e => setFiles(Array.from(e.target.files ?? []))}
        style={{ display: 'block', width: '100%', fontSize: 13, marginBottom: 12 }}
      />

      {files.length > 0 && (
        <ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', fontSize: 12, color: '#4b5563' }}>
          {files.map((f, i) => <li key={i}>• {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)</li>)}
        </ul>
      )}

      <label style={fieldLabel}>{reportLabel}</label>
      <textarea
        value={report}
        onChange={e => setReport(e.target.value)}
        rows={3}
        placeholder={category === 'photos' ? 'e.g. Mowed and edged front + rear common areas, blew walkways, trimmed hedges by pool gate.' : 'Optional note for PMI.'}
        style={taStyle}
      />

      <label style={fieldLabel}>Suggestions / issues noticed (optional)</label>
      <textarea
        value={suggestions}
        onChange={e => setSuggestions(e.target.value)}
        rows={2}
        placeholder="e.g. Sprinkler head broken near unit 12; palm by entrance needs trimming next visit."
        style={taStyle}
      />

      {error && <div style={{ fontSize: 13, color: '#991b1b', marginBottom: 10 }}>⚠ {error}</div>}

      <button onClick={submit} disabled={busy} style={{
        width: '100%', padding: '11px', borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer',
        background: busy ? '#9ca3af' : '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700,
      }}>
        {busy ? 'Uploading…' : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`.trim()}
      </button>
      <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>Large photos are compressed automatically. Max 25 MB per file.</p>
    </div>
  )
}

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#065f46', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '4px 0' }
const taStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 12, resize: 'vertical', boxSizing: 'border-box' }
