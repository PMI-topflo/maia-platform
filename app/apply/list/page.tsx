'use client'

// =====================================================================
// /apply/list?assoc=CODE  — Listing-agent entry (public, no login).
// Agent lists a unit for rent/sale, uploads the listing agreement, tags the
// owner. The owner is then emailed to validate occupancy.
// =====================================================================

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function ListForm() {
  const assoc = (useSearchParams().get('assoc') ?? '').toUpperCase()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)
  const [f, setF] = useState({ unit: '', listingType: '', agentName: '', agentEmail: '', agentPhone: '', ownerName: '', ownerEmail: '' })
  const [file, setFile] = useState<File | null>(null)

  async function submit() {
    setErr(null)
    if (!assoc) { setErr('Missing association.'); return }
    if (!f.unit.trim()) { setErr('Enter the unit.'); return }
    if (f.listingType !== 'rent' && f.listingType !== 'sale') { setErr('Choose rent or sale.'); return }
    if (!f.agentName.trim() || !f.agentEmail.trim()) { setErr('Your name and email are required.'); return }
    if (!file) { setErr('Attach the listing agreement.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      Object.entries({ assoc, ...f }).forEach(([k, v]) => fd.append(k, v))
      fd.append('agreement', file)
      const res = await fetch('/api/apply/list', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Something went wrong.'); return }
      setDone(true)
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  const wrap: React.CSSProperties = { maxWidth: 520, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }
  const field: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box', marginTop: 4 }
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 14, display: 'block' }

  if (done) return (
    <div style={wrap}>
      <h1 style={{ color: '#f26a1b' }}>✅ Listing received</h1>
      <p>Thanks! We&apos;ve recorded the listing for <strong>Unit {f.unit}</strong> and notified the owner to confirm the details. You now have access to the association&apos;s budget &amp; financials — check your email for the link.</p>
    </div>
  )

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 22, color: '#f26a1b', marginBottom: 2 }}>List a unit (agent)</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>{assoc || '—'}</p>

      <label style={label}>Unit number
        <input style={field} value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} placeholder="e.g. 4 or 701" /></label>
      <label style={label}>Listing type
        <select style={field} value={f.listingType} onChange={e => setF({ ...f, listingType: e.target.value })}>
          <option value="">Choose…</option><option value="rent">For Rent</option><option value="sale">For Sale</option>
        </select></label>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 22 }}>Your info (listing agent)</div>
      <label style={label}>Your name
        <input style={field} value={f.agentName} onChange={e => setF({ ...f, agentName: e.target.value })} /></label>
      <label style={label}>Your email
        <input style={field} type="email" value={f.agentEmail} onChange={e => setF({ ...f, agentEmail: e.target.value })} /></label>
      <label style={label}>Your phone
        <input style={field} value={f.agentPhone} onChange={e => setF({ ...f, agentPhone: e.target.value })} /></label>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 22 }}>Owner (we&apos;ll notify them)</div>
      <label style={label}>Owner name
        <input style={field} value={f.ownerName} onChange={e => setF({ ...f, ownerName: e.target.value })} placeholder="Optional" /></label>
      <label style={label}>Owner email
        <input style={field} type="email" value={f.ownerEmail} onChange={e => setF({ ...f, ownerEmail: e.target.value })} placeholder="Optional — helps us reach them" /></label>

      <label style={label}>Listing agreement (PDF)
        <input style={{ ...field, padding: 8 }} type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>

      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={submit} disabled={busy}
        style={{ width: '100%', marginTop: 20, padding: 13, fontSize: 16, fontWeight: 700, color: '#fff', background: busy ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Submitting…' : 'Submit listing'}
      </button>
    </div>
  )
}

export default function ApplyListPage() {
  return <Suspense fallback={<div style={{ padding: 24, fontFamily: 'system-ui' }}>Loading…</div>}><ListForm /></Suspense>
}
