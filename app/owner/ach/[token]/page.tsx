'use client'

import { use, useEffect, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'

interface Info { name: string; unit: string | null; address: string | null; association: string; account: string; email: string | null; phone: string | null }

export default function OwnerAchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [info, setInfo]   = useState<Info | null>(null)
  const [err, setErr]     = useState<string | null>(null)
  const [done, setDone]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [review, setReview] = useState(false)   // confirm step before submitting
  const [f, setF] = useState({ bankName: '', accountOwnerName: '', routing: '', account: '', accountType: '', phone: '', signature: '', signatureImage: '', authorized: false })

  useEffect(() => {
    fetch(`/api/owner/ach/${token}`).then(r => r.json()).then(d => {
      if (d.ok) { setInfo(d); setF(s => ({ ...s, accountOwnerName: d.name, phone: d.phone ?? '' })) }
      else setErr(d.error ?? 'This link is invalid.')
    }).catch(() => setErr('Could not load the form.'))
  }, [token])

  // Validate the form, then move to the review screen (no submit yet).
  function toReview() {
    setErr(null)
    if (!f.bankName.trim())   { setErr('Please enter your bank name.'); return }
    if (f.routing.length !== 9) { setErr('Routing number must be 9 digits.'); return }
    if (f.account.length < 4)   { setErr('Please enter a valid account number.'); return }
    if (f.accountType !== 'checking' && f.accountType !== 'savings') { setErr('Choose checking or savings.'); return }
    if (!f.signature.trim())  { setErr('Please type your full name.'); return }
    if (!f.signatureImage)    { setErr('Please sign in the box above.'); return }
    if (!f.authorized)        { setErr('Please check the authorization box.'); return }
    setReview(true)
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }

  async function submit() {
    setErr(null); setBusy(true)
    try {
      const res = await fetch(`/api/owner/ach/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Something went wrong.'); setReview(false); return }
      setDone(true)
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  const wrap: React.CSSProperties = { maxWidth: 520, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }
  const field: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box', marginTop: 4 }
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 14, display: 'block' }

  if (err && !info)  return <div style={wrap}><h2>⚠ {err}</h2></div>
  if (!info)         return <div style={wrap}><p>Loading…</p></div>
  if (done) return (
    <div style={wrap}>
      <h1 style={{ color: '#f26a1b' }}>✅ Thank you!</h1>
      <p>We&apos;ve received your signed autopay authorization for <strong>Unit {info.unit ?? info.account}</strong> at {info.association}. Our team will set up your automatic ACH, drafted on the 1st of the month. We&apos;ll reach out if we need anything.</p>
      <p style={{ color: '#6b7280', fontSize: 13 }}>Questions? ar@topfloridaproperties.com · (305) 900-5105</p>
    </div>
  )

  // ---- Review / confirm step --------------------------------------------
  if (review) {
    const Row = ({ k, v }: { k: string; v: string }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}>
        <span style={{ color: '#6b7280' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v || '—'}</span>
      </div>
    )
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 21, color: '#f26a1b', marginBottom: 2 }}>Please review your details</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>Confirm everything is correct, then submit. You can go back to edit.</p>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '4px 14px', marginTop: 8 }}>
          <Row k="Property" v={`Unit ${info.unit ?? info.account} · ${info.association}`} />
          <Row k="Phone" v={f.phone} />
          <Row k="Bank" v={f.bankName} />
          <Row k="Name on account" v={f.accountOwnerName} />
          <Row k="Account type" v={f.accountType} />
          <Row k="Routing number" v={f.routing} />
          <Row k="Account number" v={f.account} />
          <Row k="Signed by" v={f.signature} />
        </div>
        {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
        <button onClick={submit} disabled={busy}
          style={{ width: '100%', marginTop: 18, padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: busy ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Submitting…' : 'Confirm & submit'}
        </button>
        <button onClick={() => { setReview(false); setErr(null) }} disabled={busy}
          style={{ width: '100%', marginTop: 10, padding: '12px', fontSize: 15, fontWeight: 600, color: '#374151', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer' }}>
          ← Edit my details
        </button>
      </div>
    )
  }

  // ---- Form step ---------------------------------------------------------
  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 22, color: '#f26a1b', marginBottom: 2 }}>Set up automatic payments (ACH)</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>{info.name} · Unit {info.unit ?? info.account} · {info.association}</p>

      <label style={label}>Phone number
        <input style={field} inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="(305) 555-1234" /></label>
      <label style={label}>Bank name
        <input style={field} value={f.bankName} onChange={e => setF({ ...f, bankName: e.target.value })} placeholder="e.g. Bank of America" /></label>
      <label style={label}>Name on the bank account
        <input style={field} value={f.accountOwnerName} onChange={e => setF({ ...f, accountOwnerName: e.target.value })} /></label>
      <label style={label}>Routing number (9 digits)
        <input style={field} inputMode="numeric" value={f.routing} onChange={e => setF({ ...f, routing: e.target.value.replace(/\D/g, '').slice(0, 9) })} placeholder="•••••••••" /></label>
      <label style={label}>Account number
        <input style={field} inputMode="numeric" value={f.account} onChange={e => setF({ ...f, account: e.target.value.replace(/\D/g, '') })} placeholder="••••••••••" /></label>
      <label style={label}>Account type
        <select style={field} value={f.accountType} onChange={e => setF({ ...f, accountType: e.target.value })}>
          <option value="">Choose…</option><option value="checking">Checking</option><option value="savings">Savings</option>
        </select></label>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, fontSize: 12.5, color: '#374151', lineHeight: 1.45 }}>
        <input type="checkbox" checked={f.authorized} onChange={e => setF({ ...f, authorized: e.target.checked })} style={{ marginTop: 3 }} />
        <span>I authorize PMI Top Florida Properties to initiate entries from my checking/savings account the full amount of all charges uploaded in the account. This authority will remain in effect until I notify you in writing to cancel it in such time as to afford the company a reasonable opportunity to act on it.</span>
      </label>
      <label style={label}>Type your full name
        <input style={field} value={f.signature} onChange={e => setF({ ...f, signature: e.target.value })} placeholder="Your full legal name" /></label>
      <div style={{ ...label, marginBottom: 4 }}>Sign below
        <SignaturePad onChange={img => setF({ ...f, signatureImage: img ?? '' })} /></div>

      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={toReview}
        style={{ width: '100%', marginTop: 20, padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: '#f26a1b', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
        Review &amp; continue →
      </button>
      <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 12, textAlign: 'center' }}>🔒 Your bank details are sent securely to your association&apos;s management system and are not stored here.</p>
    </div>
  )
}
