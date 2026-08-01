'use client'

// Login-free lease-packet e-signature page. The owner and the tenant each
// open their own link (role encoded in the token), review the Landlord–
// Tenant Agreement, and sign electronically (typed name + drawn signature).

import { use, useEffect, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'

interface Info {
  role: 'owner' | 'tenant'
  associationLegalName: string
  unit: string | null
  ownerName: string | null
  tenantName: string | null
  leaseStart: string | null
  leaseEnd: string | null
  signerName: string | null
  signerEmail: string | null
  alreadySigned: boolean
  otherPartySigned: boolean
  status: string
  voided: boolean
}

const fmt = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  // Date-only lease values parse as UTC midnight — format in UTC so a
  // June 1 stays June 1 (ET conversion would shift it back a day).
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export default function LeasePacketSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [sigImage, setSigImage] = useState('')
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    fetch(`/api/lease-packet/${token}`).then(r => r.json()).then(d => {
      if (d.error) setErr(d.error)
      else { setInfo(d); setName(d.signerName ?? '') }
    }).catch(() => setErr('Network error — please reload.'))
  }, [token])

  async function submit() {
    setErr(null)
    if (!agreed) { setErr('Please check the consent box to sign.'); return }
    if (!name.trim()) { setErr('Please type your full legal name.'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/lease-packet/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, signatureImage: sigImage, agreed }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Could not submit.'); setBusy(false); return }
      setDone(true)
    } catch { setErr('Network error — please try again.') } finally { setBusy(false) }
  }

  const wrap: React.CSSProperties = { maxWidth: 640, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }
  const field: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box', marginTop: 4 }
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 16, display: 'block' }
  const roleLabel = info?.role === 'owner' ? 'Unit Owner / Landlord' : 'Tenant'

  if (err && !info) return <div style={wrap}><h2>⚠ {err}</h2></div>
  if (!info) return <div style={wrap}><p>Loading…</p></div>
  if (info.voided) return <div style={wrap}><h2>This lease packet is no longer active.</h2><p style={{ color: '#6b7280' }}>Please contact PMI Top Florida Properties if you have questions.</p></div>

  if (done || info.alreadySigned) return (
    <div style={wrap}>
      <h1 style={{ color: '#f26a1b' }}>✅ Thank you!</h1>
      <p>Your electronic signature on the Landlord–Tenant Agreement for <strong>Unit {info.unit}</strong> has been recorded. A completed copy is retained by the Association.</p>
      <p style={{ marginTop: 14 }}><a href={`/api/lease-packet/${token}/pdf`} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>View the document (PDF) →</a></p>
      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 18 }}>Questions? PMI Top Florida Properties · (305) 900-5105</p>
    </div>
  )

  return (
    <div style={wrap}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', margin: 0 }}>{info.associationLegalName}</p>
      <h1 style={{ fontSize: 22, color: '#1f2a44', margin: '4px 0 2px' }}>Landlord–Tenant Agreement</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>You are signing as the <strong>{roleLabel}</strong> for Unit {info.unit}.</p>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '4px 14px', marginTop: 8 }}>
        {[['Unit', info.unit ?? '—'], ['Unit Owner', info.ownerName ?? '—'], ['Tenant', info.tenantName ?? '—'], ['Lease term', `${fmt(info.leaseStart)} — ${fmt(info.leaseEnd)}`]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}>
            <span style={{ color: '#6b7280' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 16 }}>
        <a href={`/api/lease-packet/${token}/pdf`} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>📄 Read the full Agreement (PDF) →</a>
      </p>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Please review the full document before signing. By signing you acknowledge the Governing Documents and agree to comply with them.</p>

      <label style={label}>Your full legal name
        <input style={field} value={name} onChange={e => setName(e.target.value)} placeholder="Full legal name" /></label>

      <div style={{ marginTop: 16 }}>
        <label style={{ ...label, marginTop: 0 }}>Draw your signature</label>
        <SignaturePad onChange={img => setSigImage(img ?? '')} />
      </div>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, fontSize: 13.5, color: '#374151', lineHeight: 1.5 }}>
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I consent to sign electronically. I confirm I am {info.signerName ? <strong>{info.signerName}</strong> : 'the person named above'} and intend my electronic signature to be legally binding to the same extent as a handwritten signature. I understand my name, signature, timestamp, email, and IP address are recorded as an audit trail.</span>
      </label>

      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={submit} disabled={busy}
        style={{ width: '100%', marginTop: 18, padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: busy ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Submitting…' : 'Sign & submit'}
      </button>
      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 12, textAlign: 'center' }}>PMI Top Florida Properties · This link is specific to you.</p>
    </div>
  )
}
