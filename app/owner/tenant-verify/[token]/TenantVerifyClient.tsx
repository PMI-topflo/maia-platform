'use client'

import { useEffect, useState } from 'react'

interface Status {
  associationName: string | null; unit: string | null
  tenantName: string | null; tenantEmail: string | null; tenantPhone: string | null
  hasLease: boolean; hasBoardLetter: boolean
  ownerConfirmed: boolean; status: string
}

export default function TenantVerifyClient({ token }: { token: string }) {
  const [s, setS] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'yes' | 'no' | null>(null)
  const [decided, setDecided] = useState<'yes' | 'no' | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState<'lease' | 'board_letter' | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/owner/tenant-verify/${token}`).then(r => r.json()).then((d: Status) => {
      if (!alive) return
      setS(d)
      if (d.ownerConfirmed) setDecided('yes')
      else if (d.status === 'rejected') setDecided('no')
    }).catch(() => { if (alive) setError('Could not load this request.') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  async function confirm(value: boolean) {
    setConfirming(value ? 'yes' : 'no'); setError(null)
    try {
      const res = await fetch(`/api/owner/tenant-verify/${token}/confirm`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: value }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setDecided(value ? 'yes' : 'no')
    } catch (e) { setError((e as Error).message) } finally { setConfirming(null) }
  }

  async function upload(docType: 'lease' | 'board_letter', file: File) {
    setUploadingDoc(docType); setError(null)
    try {
      const fd = new FormData(); fd.append('docType', docType); fd.append('file', file)
      const res = await fetch(`/api/owner/tenant-verify/${token}/upload`, { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'upload failed')
      setS(prev => prev ? { ...prev, hasLease: j.hasLease, hasBoardLetter: j.hasBoardLetter } : prev)
    } catch (e) { setError((e as Error).message) } finally { setUploadingDoc(null) }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#6b7280' }}>Loading…</p>
  if (!s) return <p style={{ fontSize: 14, color: '#991b1b' }}>{error ?? 'Could not load this request.'}</p>

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '4px 0 8px' }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>Is this your tenant?</h1>
      <div style={{ fontSize: 13, color: '#4b5563' }}>{s.associationName}{s.unit ? ` · Unit ${s.unit}` : ''}</div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '14px 0 18px', lineHeight: 1.5 }}>
        <strong>{s.tenantName ?? 'Someone'}</strong> ({s.tenantEmail ?? s.tenantPhone ?? 'no contact on file'}) told PMI Top Florida Properties they are the tenant of your unit. Please confirm.
      </p>

      {decided === null ? (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <button onClick={() => confirm(true)} disabled={!!confirming}
            style={{ flex: 1, padding: 11, borderRadius: 8, border: 'none', cursor: 'pointer', background: '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700 }}>
            {confirming === 'yes' ? 'Saving…' : 'Yes, that’s my tenant'}
          </button>
          <button onClick={() => confirm(false)} disabled={!!confirming}
            style={{ flex: 1, padding: 11, borderRadius: 8, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#374151', fontSize: 14, fontWeight: 700 }}>
            {confirming === 'no' ? 'Saving…' : 'No'}
          </button>
        </div>
      ) : decided === 'no' ? (
        <div style={{ padding: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 14, color: '#991b1b' }}>Thanks — we&apos;ve flagged this for our team to follow up.</div>
      ) : (
        <>
          <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46', marginBottom: 18 }}>✓ Thanks for confirming.</div>
          {(!s.hasLease || !s.hasBoardLetter) && (
            <>
              <div style={label}>Upload whatever&apos;s still missing</div>
              {!s.hasLease && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Lease agreement</div>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" disabled={uploadingDoc === 'lease'}
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload('lease', f) }} style={{ display: 'block', width: '100%', fontSize: 13 }} />
                  {uploadingDoc === 'lease' && <div style={{ fontSize: 12, color: '#9ca3af' }}>Uploading…</div>}
                </div>
              )}
              {!s.hasBoardLetter && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Board approval letter</div>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" disabled={uploadingDoc === 'board_letter'}
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload('board_letter', f) }} style={{ display: 'block', width: '100%', fontSize: 13 }} />
                  {uploadingDoc === 'board_letter' && <div style={{ fontSize: 12, color: '#9ca3af' }}>Uploading…</div>}
                </div>
              )}
            </>
          )}
          {s.hasLease && s.hasBoardLetter && <div style={{ fontSize: 13, color: '#065f46' }}>All documents on file — thank you!</div>}
        </>
      )}
      {error && <div style={{ fontSize: 13, color: '#991b1b', marginTop: 10 }}>⚠ {error}</div>}
    </div>
  )
}
