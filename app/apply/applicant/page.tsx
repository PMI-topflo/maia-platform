'use client'

// =====================================================================
// /apply/applicant?assoc=CODE&role=tenant|buyer  — Applicant entry (public).
// Upload the lease / purchase agreement, add your agent (optional). Your agent
// is notified you started; you get the financials access link by email.
// =====================================================================

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function ApplicantForm() {
  const sp = useSearchParams()
  const assoc = (sp.get('assoc') ?? '').toUpperCase()
  const buyer = (sp.get('role') ?? '') === 'buyer'
  const agreementKind = buyer ? 'purchase_agreement' : 'lease'

  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)
  const [f, setF] = useState({ applicantName: '', applicantEmail: '', applicantPhone: '', agentName: '', agentEmail: '', agentPhone: '', unit: '' })
  const [file, setFile] = useState<File | null>(null)

  async function submit() {
    setErr(null)
    if (!assoc) { setErr('Missing association.'); return }
    if (!f.unit.trim()) { setErr('Enter the unit.'); return }
    if (!f.applicantName.trim() || !f.applicantEmail.trim()) { setErr('Your name and email are required.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      Object.entries({ assoc, agreementKind, ...f }).forEach(([k, v]) => fd.append(k, v))
      if (file) fd.append('agreement', file)
      const res = await fetch('/api/apply/applicant', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Something went wrong.'); return }
      setDone(true)
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  const wrap: React.CSSProperties = { maxWidth: 520, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }
  const field: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box', marginTop: 4 }
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 14, display: 'block' }
  const head:  React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 22 }

  if (done) return (
    <div style={wrap}>
      <h1 style={{ color: '#f26a1b' }}>✅ Application started</h1>
      <p>Thanks, {f.applicantName.split(' ')[0]}! We&apos;ve recorded your start for <strong>Unit {f.unit}</strong>{f.agentEmail ? ' and notified your agent' : ''}. Check your email for your access to the association&apos;s budget &amp; financials.</p>
    </div>
  )

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 22, color: '#f26a1b', marginBottom: 2 }}>{buyer ? 'Buyer' : 'Tenant'} application</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>{assoc || '—'}</p>

      <label style={label}>Unit number
        <input style={field} value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} placeholder="e.g. 4 or 701" /></label>

      <div style={head}>Your info</div>
      <label style={label}>Full name
        <input style={field} value={f.applicantName} onChange={e => setF({ ...f, applicantName: e.target.value })} /></label>
      <label style={label}>Email
        <input style={field} type="email" value={f.applicantEmail} onChange={e => setF({ ...f, applicantEmail: e.target.value })} /></label>
      <label style={label}>Phone
        <input style={field} value={f.applicantPhone} onChange={e => setF({ ...f, applicantPhone: e.target.value })} /></label>

      <div style={head}>Your agent (optional)</div>
      <label style={label}>Agent name
        <input style={field} value={f.agentName} onChange={e => setF({ ...f, agentName: e.target.value })} placeholder="Optional" /></label>
      <label style={label}>Agent email
        <input style={field} type="email" value={f.agentEmail} onChange={e => setF({ ...f, agentEmail: e.target.value })} placeholder="Optional — we'll notify them you started" /></label>
      <label style={label}>Agent phone
        <input style={field} value={f.agentPhone} onChange={e => setF({ ...f, agentPhone: e.target.value })} placeholder="Optional" /></label>

      <label style={label}>{buyer ? 'Purchase agreement' : 'Signed lease'} (PDF)
        <input style={{ ...field, padding: 8 }} type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>

      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={submit} disabled={busy}
        style={{ width: '100%', marginTop: 20, padding: 13, fontSize: 16, fontWeight: 700, color: '#fff', background: busy ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Submitting…' : 'Start my application'}
      </button>
    </div>
  )
}

export default function ApplyApplicantPage() {
  return <Suspense fallback={<div style={{ padding: 24, fontFamily: 'system-ui' }}>Loading…</div>}><ApplicantForm /></Suspense>
}
