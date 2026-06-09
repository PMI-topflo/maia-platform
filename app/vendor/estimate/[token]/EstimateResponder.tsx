'use client'

// Vendor RFQ responder — see scope + photos, accept-to-quote (+ respond-by
// date), then upload the estimate. All token-gated via the parent route.

import { useState } from 'react'

export default function EstimateResponder({
  token, vendorName, scope, photos, initialStatus, respondBy,
}: {
  token: string; vendorName: string | null; scope: string; photos: string[]
  initialStatus: string; respondBy: string | null
}) {
  const [status, setStatus] = useState(initialStatus)
  const [date, setDate] = useState(respondBy ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState(false)

  const accepted = status === 'accepted' || status === 'submitted'

  async function act(action: 'accept' | 'decline') {
    if (action === 'accept' && !date) { setError('Pick the date you can respond by.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/vendor/estimate/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, respond_by: date || null }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setStatus(d.status)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  async function upload(f: File | null) {
    if (!f) return
    setBusy(true); setError(null)
    try {
      const fd = new FormData(); fd.append('files', f)
      const res = await fetch(`/api/vendor/estimate/${token}`, { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'upload failed')
      setStatus('submitted'); setUploaded(true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginTop: 12 }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280' }}>Scope of work</div>
      <div style={{ fontSize: 14, color: '#111827', whiteSpace: 'pre-wrap', margin: '4px 0 12px' }}>{scope}</div>

      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          {photos.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`photo ${i + 1}`} style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e7eb' }} />
            </a>
          ))}
        </div>
      )}

      {status === 'declined' ? (
        <div style={{ ...card, background: '#fef2f2', color: '#991b1b' }}>You declined this request. If that was a mistake, contact PMI.</div>
      ) : status === 'submitted' || uploaded ? (
        <div style={{ ...card, background: '#ecfdf5', color: '#065f46' }}>✓ Thank you — your estimate was received. PMI will be in touch.</div>
      ) : (
        <>
          {!accepted ? (
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 8 }}>Can you quote this?</div>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>I&apos;ll respond by</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 12, display: 'block' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => act('accept')} disabled={busy} style={btn('#f26a1b')}>{busy ? '…' : 'Accept to quote'}</button>
                <button onClick={() => act('decline')} disabled={busy} style={btn('#9ca3af')}>Decline</button>
              </div>
            </div>
          ) : (
            <div style={{ ...card, background: '#f0fdf4' }}>
              <div style={{ fontSize: 13, color: '#065f46', marginBottom: 10 }}>✓ Accepted to quote{date ? ` · responding by ${date}` : ''}. Upload your estimate when ready:</div>
              <label style={{ display: 'inline-block', cursor: 'pointer', background: '#f26a1b', color: '#fff', padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*" style={{ display: 'none' }} disabled={busy} onChange={e => upload(e.target.files?.[0] ?? null)} />
                {busy ? 'Uploading…' : 'Upload estimate'}
              </label>
            </div>
          )}
        </>
      )}

      {error && <div style={{ fontSize: 13, color: '#991b1b', marginTop: 10 }}>⚠ {error}</div>}
      {vendorName && <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 14 }}>For {vendorName}</p>}
    </div>
  )
}

const btn = (bg: string): React.CSSProperties => ({ padding: '9px 14px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' })
