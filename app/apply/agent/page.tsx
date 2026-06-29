'use client'

// =====================================================================
// /apply/agent?assoc=CODE  — Applicant's-agent entry (public).
// Upload the lease / purchase agreement and add every applicant's contact
// info. The agent + applicants get the financials access link by email.
// =====================================================================

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

interface Applicant { name: string; email: string; phone: string }

function AgentForm() {
  const assoc = (useSearchParams().get('assoc') ?? '').toUpperCase()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)
  const [f, setF] = useState({ unit: '', agreementKind: 'lease', agentName: '', agentEmail: '', agentPhone: '' })
  const [file, setFile] = useState<File | null>(null)
  const [applicants, setApplicants] = useState<Applicant[]>([{ name: '', email: '', phone: '' }])

  const setApp = (i: number, k: keyof Applicant, v: string) =>
    setApplicants(a => a.map((x, j) => j === i ? { ...x, [k]: v } : x))

  async function submit() {
    setErr(null)
    if (!assoc) { setErr('Missing association.'); return }
    if (!f.unit.trim()) { setErr('Enter the unit.'); return }
    if (!f.agentName.trim() || !f.agentEmail.trim()) { setErr('Your name and email are required.'); return }
    const clean = applicants.filter(a => a.name || a.email || a.phone)
    if (!clean.length) { setErr('Add at least one applicant.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      Object.entries({ assoc, ...f }).forEach(([k, v]) => fd.append(k, v))
      fd.append('applicants', JSON.stringify(clean))
      if (file) fd.append('agreement', file)
      const res = await fetch('/api/apply/agent', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Something went wrong.'); return }
      setDone(true)
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  const wrap: React.CSSProperties = { maxWidth: 540, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }
  const field: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box', marginTop: 4 }
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 14, display: 'block' }
  const head:  React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 22 }

  if (done) return (
    <div style={wrap}>
      <h1 style={{ color: '#f26a1b' }}>✅ Application submitted</h1>
      <p>Thanks! We&apos;ve recorded the application for <strong>Unit {f.unit}</strong> with {applicants.filter(a => a.name || a.email).length} applicant(s). Everyone added has been emailed access to the association&apos;s budget &amp; financials.</p>
    </div>
  )

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 22, color: '#f26a1b', marginBottom: 2 }}>Submit an application (agent)</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>{assoc || '—'}</p>

      <label style={label}>Unit number
        <input style={field} value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} placeholder="e.g. 4 or 701" /></label>
      <label style={label}>Type
        <select style={field} value={f.agreementKind} onChange={e => setF({ ...f, agreementKind: e.target.value })}>
          <option value="lease">Rental (lease)</option><option value="purchase_agreement">Purchase (sale)</option>
        </select></label>

      <div style={head}>Your info (agent)</div>
      <label style={label}>Your name
        <input style={field} value={f.agentName} onChange={e => setF({ ...f, agentName: e.target.value })} /></label>
      <label style={label}>Your email
        <input style={field} type="email" value={f.agentEmail} onChange={e => setF({ ...f, agentEmail: e.target.value })} /></label>
      <label style={label}>Your phone
        <input style={field} value={f.agentPhone} onChange={e => setF({ ...f, agentPhone: e.target.value })} /></label>

      <div style={head}>Applicants</div>
      {applicants.map((a, i) => (
        <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 10 }}>
          <input style={field} value={a.name}  onChange={e => setApp(i, 'name', e.target.value)}  placeholder="Full name" />
          <input style={field} value={a.email} onChange={e => setApp(i, 'email', e.target.value)} placeholder="Email" type="email" />
          <input style={field} value={a.phone} onChange={e => setApp(i, 'phone', e.target.value)} placeholder="Phone" />
          {applicants.length > 1 && (
            <button onClick={() => setApplicants(x => x.filter((_, j) => j !== i))}
              style={{ marginTop: 8, fontSize: 12, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Remove</button>
          )}
        </div>
      ))}
      <button onClick={() => setApplicants(a => [...a, { name: '', email: '', phone: '' }])}
        style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: '#f26a1b', background: 'none', border: '1px dashed #f26a1b', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>+ Add another applicant</button>

      <label style={label}>Lease / purchase agreement (PDF)
        <input style={{ ...field, padding: 8 }} type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>

      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={submit} disabled={busy}
        style={{ width: '100%', marginTop: 20, padding: 13, fontSize: 16, fontWeight: 700, color: '#fff', background: busy ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
    </div>
  )
}

export default function ApplyAgentPage() {
  return <Suspense fallback={<div style={{ padding: 24, fontFamily: 'system-ui' }}>Loading…</div>}><AgentForm /></Suspense>
}
