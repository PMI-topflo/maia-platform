'use client'

import { useEffect, useState } from 'react'

interface MissingItem { key: string; label: string }
interface Status { ownerName: string | null; unit: string | null; associationName: string | null; occupancy: string | null; missing: MissingItem[] }
type Occ = 'owner_occupied' | 'leased' | 'vacant'
const OCC: { key: Occ; label: string; hint: string }[] = [
  { key: 'owner_occupied', label: 'Owner-occupied', hint: 'You live here' },
  { key: 'leased', label: 'Leased', hint: 'A tenant rents it' },
  { key: 'vacant', label: 'Vacant', hint: 'No one lives here' },
]

export default function OwnerComplianceClient({ token }: { token: string }) {
  const [s, setS] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingOcc, setSavingOcc] = useState<Occ | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/owner/compliance/${token}`).then(r => r.json())
      .then((d: Status) => { if (alive) setS(d) })
      .catch(() => { if (alive) setError('Could not load your unit.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  async function setOccupancy(status: Occ) {
    setSavingOcc(status); setError(null)
    try {
      const res = await fetch(`/api/owner/compliance/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setS(prev => prev ? { ...prev, occupancy: status, missing: j.missing ?? prev.missing } : prev)
    } catch (e) { setError((e as Error).message) } finally { setSavingOcc(null) }
  }

  async function upload() {
    if (files.length === 0) { setError('Choose at least one file.'); return }
    setBusy(true); setError(null); setDone(null)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      const res = await fetch(`/api/owner/compliance/${token}/upload`, { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'upload failed')
      setDone(`Thank you — ${j.saved} file(s) received. PMI will review and file them.`)
      setFiles([])
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#6b7280' }}>Loading…</p>
  if (!s) return <p style={{ fontSize: 14, color: '#991b1b' }}>{error ?? 'Could not load your unit.'}</p>

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>Your unit documents</h1>
      <div style={{ fontSize: 13, color: '#4b5563' }}>
        {s.ownerName ? `${s.ownerName} · ` : ''}{s.associationName}{s.unit ? ` · Unit ${s.unit}` : ''}
      </div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '14px 0 18px', lineHeight: 1.5 }}>
        Help us keep your file current. First, tell us how the unit is used — then upload anything we’re still missing.
      </p>

      {/* Occupancy */}
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', marginBottom: 8 }}>How is this unit used?</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {OCC.map(o => {
          const active = s.occupancy === o.key
          return (
            <button key={o.key} onClick={() => setOccupancy(o.key)} disabled={!!savingOcc} style={{
              flex: '1 1 150px', textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              border: active ? '2px solid #f26a1b' : '1px solid #d1d5db', background: active ? '#fff7ed' : '#fff',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: active ? '#c2410c' : '#111827' }}>{savingOcc === o.key ? 'Saving…' : o.label}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{o.hint}</div>
            </button>
          )
        })}
      </div>

      {/* Missing docs */}
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', marginBottom: 8 }}>
        Documents we still need {s.occupancy ? '' : '(answer above to tailor this list)'}
      </div>
      {s.missing.length === 0 ? (
        <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46', marginBottom: 18 }}>
          ✓ Your unit file looks complete — thank you!
        </div>
      ) : (
        <ul style={{ margin: '0 0 18px', padding: 0, listStyle: 'none' }}>
          {s.missing.map(m => (
            <li key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', padding: '5px 0', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ color: '#dc2626' }}>•</span>{m.label}
            </li>
          ))}
        </ul>
      )}

      {/* Upload */}
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', marginBottom: 8 }}>Upload your documents</div>
      {done ? (
        <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46' }}>✓ {done}
          <div style={{ marginTop: 10 }}><button onClick={() => setDone(null)} style={{ background: 'none', border: 'none', color: '#065f46', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }}>Upload more</button></div>
        </div>
      ) : (
        <>
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*"
            onChange={e => setFiles(Array.from(e.target.files ?? []))}
            style={{ display: 'block', width: '100%', fontSize: 13, marginBottom: 12 }} />
          {files.length > 0 && <ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', fontSize: 12, color: '#4b5563' }}>{files.map((f, i) => <li key={i}>• {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)</li>)}</ul>}
          {error && <div style={{ fontSize: 13, color: '#991b1b', marginBottom: 10 }}>⚠ {error}</div>}
          <button onClick={upload} disabled={busy} style={{ width: '100%', padding: 11, borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer', background: busy ? '#9ca3af' : '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700 }}>{busy ? 'Uploading…' : 'Upload'}</button>
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>PDF, JPG, PNG accepted. PMI reviews each before filing.</p>
        </>
      )}
    </div>
  )
}
