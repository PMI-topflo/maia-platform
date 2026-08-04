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
  signerEmailMasked: string | null
  signerPhoneMasked: string | null
  phoneRequired: boolean
  emailVerified: boolean
  phoneVerified: boolean
  alreadySigned: boolean
  otherPartySigned: boolean
  status: string
  voided: boolean
}

interface Geo { lat: number; lon: number; accuracy_meters: number; timestamp_ms: number }

// Best-effort browser geolocation with a short timeout — declines fall back to
// IP-based location captured server-side. Never blocks signing.
function captureGeo(): Promise<Geo | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy_meters: pos.coords.accuracy ?? 0, timestamp_ms: Date.now() }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    )
  })
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
  const [emailV, setEmailV] = useState(false)
  const [phoneV, setPhoneV] = useState(false)

  useEffect(() => {
    fetch(`/api/lease-packet/${token}`).then(r => r.json()).then(d => {
      if (d.error) setErr(d.error)
      else { setInfo(d); setName(d.signerName ?? ''); setEmailV(!!d.emailVerified); setPhoneV(!!d.phoneVerified) }
    }).catch(() => setErr('Network error — please reload.'))
  }, [token])

  const verifiedEnough = emailV && (!info?.phoneRequired || phoneV)

  async function submit() {
    setErr(null)
    if (!verifiedEnough) { setErr('Please verify your identity above before signing.'); return }
    if (!agreed) { setErr('Please check the consent box to sign.'); return }
    if (!name.trim()) { setErr('Please type your full legal name.'); return }
    setBusy(true)
    try {
      const geo = await captureGeo()
      const res = await fetch(`/api/lease-packet/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, signatureImage: sigImage, agreed, geo }),
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

      {/* Step 1 — verify identity (email always; phone when a mobile is on file). */}
      <div style={{ marginTop: 20, padding: 14, border: '1px solid #e5e7eb', borderRadius: 10, background: verifiedEnough ? '#f0fdf4' : '#fafafa' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' }}>Step 1 · Verify your identity</div>
        <p style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 12px' }}>We send you a one-time code to confirm it&apos;s really you before you sign. This becomes part of the signed record.</p>
        <VerifyFactor token={token} factor="email" masked={info.signerEmailMasked} verified={emailV} onVerified={() => setEmailV(true)} />
        {info.phoneRequired && (
          <div style={{ marginTop: 10 }}>
            <VerifyFactor token={token} factor="phone" masked={info.signerPhoneMasked} verified={phoneV} onVerified={() => setPhoneV(true)} />
          </div>
        )}
      </div>

      <label style={{ ...label, opacity: verifiedEnough ? 1 : 0.5 }}>Your full legal name
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
      {!verifiedEnough && <p style={{ color: '#92400e', fontSize: 12.5, marginTop: 12 }}>Verify your identity in Step 1 to enable signing.</p>}
      <button onClick={submit} disabled={busy || !verifiedEnough}
        style={{ width: '100%', marginTop: 12, padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: (busy || !verifiedEnough) ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: (busy || !verifiedEnough) ? 'default' : 'pointer' }}>
        {busy ? 'Submitting…' : 'Sign & submit'}
      </button>
      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 12, textAlign: 'center' }}>PMI Top Florida Properties · This link is specific to you.</p>
    </div>
  )
}

// One identity factor (email, or phone via SMS/WhatsApp): send a code, enter it,
// verify. Green once confirmed.
function VerifyFactor({ token, factor, masked, verified, onVerified }: {
  token: string; factor: 'email' | 'phone'; masked: string | null; verified: boolean; onVerified: () => void
}) {
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState<string | null>(null)
  const ch = factor === 'email' ? 'email' : channel

  async function send() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/lease-packet/${token}/send-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: ch }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not send')
      setSent(true); setMsg(`Code sent to ${d.sentTo}.`)
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  async function verify() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/lease-packet/${token}/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: ch, code }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not verify')
      onVerified()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  const title = factor === 'email' ? 'Email' : 'Mobile phone'
  const btn: React.CSSProperties = { padding: '8px 12px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer', color: '#fff', background: busy ? '#9ca3af' : '#2563eb' }

  if (verified) return <div style={{ fontSize: 13.5, color: '#166534', fontWeight: 600 }}>✓ {title} verified{masked ? ` · ${masked}` : ''}</div>

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fff' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{title}{masked ? <span style={{ color: '#6b7280', fontWeight: 400 }}> · {masked}</span> : ''}</div>
      {factor === 'phone' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {(['sms', 'whatsapp'] as const).map(c => (
            <button key={c} onClick={() => setChannel(c)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: `1px solid ${channel === c ? '#2563eb' : '#d1d5db'}`, background: channel === c ? '#eff6ff' : '#fff', color: channel === c ? '#1d4ed8' : '#374151', cursor: 'pointer', fontWeight: 600 }}>{c === 'sms' ? 'Text (SMS)' : 'WhatsApp'}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={send} disabled={busy} style={btn}>{sent ? 'Resend code' : 'Send code'}</button>
        {sent && (
          <>
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" inputMode="numeric"
              style={{ width: 110, padding: '8px 10px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 8, letterSpacing: 2 }} />
            <button onClick={verify} disabled={busy || code.length < 4} style={{ ...btn, background: busy || code.length < 4 ? '#9ca3af' : '#059669' }}>Verify</button>
          </>
        )}
      </div>
      {msg && <p style={{ fontSize: 12, color: msg.startsWith('Code sent') ? '#166534' : '#b91c1c', margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}
