'use client'

import { use, useEffect, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'

interface Info { name: string; unit: string | null; address: string | null; association: string; account: string }

export default function OwnerAchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [info, setInfo]   = useState<Info | null>(null)
  const [err, setErr]     = useState<string | null>(null)
  const [done, setDone]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [f, setF] = useState({ bankName: '', accountOwnerName: '', routing: '', account: '', accountType: '', signature: '', signatureImage: '', authorized: false })

  useEffect(() => {
    fetch(`/api/owner/ach/${token}`).then(r => r.json()).then(d => {
      if (d.ok) { setInfo(d); setF(s => ({ ...s, accountOwnerName: d.name })) }
      else setErr(d.error ?? 'This link is invalid.')
    }).catch(() => setErr('Could not load the form.'))
  }, [token])

  async function submit() {
    setErr(null)
    if (!f.authorized) { setErr('Please check the authorization box.'); return }
    if (!f.signature.trim()) { setErr('Please type your full name.'); return }
    if (!f.signatureImage) { setErr('Please sign in the box above.'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/owner/ach/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Something went wrong.'); return }
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
      <h1 style={{ color: '#f26a1b' }}>✅ You&apos;re all set!</h1>
      <p>Automatic ACH payments are now set up for <strong>Unit {info.unit ?? info.account}</strong> at {info.association}. Drafts come out on the 1st of each month. Our team will verify the details.</p>
      <p style={{ color: '#6b7280', fontSize: 13 }}>Questions? ar@topfloridaproperties.com · (305) 900-5105</p>
    </div>
  )

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 22, color: '#f26a1b', marginBottom: 2 }}>Set up automatic payments (ACH)</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>{info.name} · Unit {info.unit ?? info.account} · {info.association}</p>

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
      <button onClick={submit} disabled={busy}
        style={{ width: '100%', marginTop: 20, padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: busy ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Submitting…' : 'Set up autopay'}
      </button>
      <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 12, textAlign: 'center' }}>🔒 Your bank details are sent securely to your association&apos;s management system and are not stored here.</p>
    </div>
  )
}
