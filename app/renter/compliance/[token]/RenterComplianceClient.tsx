'use client'

import { useEffect, useState } from 'react'

interface MissingItem { key: string; label: string }
interface Status { associationName: string | null; unit: string | null; missing: MissingItem[]; commercial?: boolean; contact: { name: string; phone: string; email: string } }

export default function RenterComplianceClient({ token }: { token: string }) {
  const [s, setS] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState('')
  const [savedContact, setSavedContact] = useState(false)
  const [savingContact, setSavingContact] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/renter/compliance/${token}`).then(r => r.json()).then((d: Status) => {
      if (!alive) return
      setS(d); setName(d.contact?.name ?? ''); setPhone(d.contact?.phone ?? ''); setEmail(d.contact?.email ?? '')
    }).catch(() => { if (alive) setError('Could not load your unit.') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  async function saveContact() {
    setError(null); setSavingContact(true)
    try {
      const res = await fetch(`/api/renter/compliance/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, phone, email }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setS(prev => prev ? { ...prev, missing: j.missing ?? prev.missing } : prev); setSavedContact(true)
    } catch (e) { setError((e as Error).message) } finally { setSavingContact(false) }
  }

  async function upload() {
    if (files.length === 0) { setError('Choose at least one file.'); return }
    setBusy(true); setError(null); setDone(null)
    try {
      const fd = new FormData(); files.forEach(f => fd.append('files', f))
      const res = await fetch(`/api/renter/compliance/${token}/upload`, { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'upload failed')
      setDone(`Thank you — ${j.saved} file(s) received. PMI will review and file them.`); setFiles([])
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#6b7280' }}>Loading…</p>
  if (!s) return <p style={{ fontSize: 14, color: '#991b1b' }}>{error ?? 'Could not load your unit.'}</p>

  const field: React.CSSProperties = { width: '100%', padding: '9px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 10, boxSizing: 'border-box' }
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '4px 0 8px' }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 2px' }}>Your unit documents</h1>
      <div style={{ fontSize: 13, color: '#4b5563' }}>{s.associationName}{s.unit ? ` · Unit ${s.unit}` : ''}</div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '14px 0 18px', lineHeight: 1.5 }}>Welcome — please confirm your contact information and upload your documents, including your renters insurance (HO-4).</p>

      <div style={label}>Your contact information</div>
      <input value={name} onChange={e => { setName(e.target.value); setSavedContact(false) }} placeholder="Full name" style={field} />
      <input value={phone} onChange={e => { setPhone(e.target.value); setSavedContact(false) }} placeholder="Phone" inputMode="tel" style={field} />
      <input value={email} onChange={e => { setEmail(e.target.value); setSavedContact(false) }} placeholder="Email" inputMode="email" style={field} />
      <button onClick={saveContact} disabled={savingContact} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: savedContact ? '#ecfdf5' : '#fff', color: savedContact ? '#065f46' : '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 20 }}>{savingContact ? 'Saving…' : savedContact ? '✓ Saved' : 'Save contact'}</button>

      {s.commercial && (
        <div style={{ padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, fontSize: 12.5, color: '#9a3412', margin: '0 0 14px' }}>
          Your Certificate of Insurance (COI) must name the <strong>Association</strong>, the <strong>Management Company</strong>, and the <strong>Landlord / Unit Owner</strong> as <strong>additional insured</strong>.
        </div>
      )}
      <div style={label}>Documents we still need</div>
      {s.missing.length === 0 ? (
        <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46', marginBottom: 18 }}>✓ All set — thank you!</div>
      ) : (
        <ul style={{ margin: '0 0 18px', padding: 0, listStyle: 'none' }}>
          {s.missing.map(m => <li key={m.key} style={{ display: 'flex', gap: 8, fontSize: 14, color: '#374151', padding: '5px 0', borderTop: '1px solid #f1f5f9' }}><span style={{ color: '#dc2626' }}>•</span>{m.label}</li>)}
        </ul>
      )}

      <div style={label}>Upload your documents</div>
      {done ? (
        <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46' }}>✓ {done}
          <div style={{ marginTop: 10 }}><button onClick={() => setDone(null)} style={{ background: 'none', border: 'none', color: '#065f46', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }}>Upload more</button></div>
        </div>
      ) : (
        <>
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*" onChange={e => setFiles(Array.from(e.target.files ?? []))} style={{ display: 'block', width: '100%', fontSize: 13, marginBottom: 12 }} />
          {files.length > 0 && <ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', fontSize: 12, color: '#4b5563' }}>{files.map((f, i) => <li key={i}>• {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)</li>)}</ul>}
          {error && <div style={{ fontSize: 13, color: '#991b1b', marginBottom: 10 }}>⚠ {error}</div>}
          <button onClick={upload} disabled={busy} style={{ width: '100%', padding: 11, borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer', background: busy ? '#9ca3af' : '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700 }}>{busy ? 'Uploading…' : 'Upload'}</button>
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>PDF, JPG, PNG accepted. PMI reviews each before filing.</p>
        </>
      )}
    </div>
  )
}
