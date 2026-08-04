'use client'

// Public Pre-Application Compliance intake (B4). One link per association. The
// applicant self-identifies the application type, enters their contact + unit,
// uploads exactly the documents that type requires (one labeled box each, from
// the per-association checklist), then reviews the association's rules and
// signs to acknowledge them. Submitting puts it in the staff audit queue.

import { use, useCallback, useEffect, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'

const TYPES = [
  { key: 'lease',               title: 'Rent (new lease)',      blurb: 'I am applying to rent this unit' },
  { key: 'purchase',            title: 'Purchase',              blurb: 'I am buying this unit' },
  { key: 'lease_renewal',       title: 'Lease renewal',         blurb: 'I already rent here and am renewing' },
  { key: 'additional_occupant', title: 'Add an occupant',       blurb: 'Adding a person to an existing lease' },
]

interface ChecklistItem { id: string; doc_key: string; label: string; provided_by: 'applicant' | 'landlord' | 'agent'; required: boolean; note: string | null; uploaded: boolean }
interface Info {
  associationName: string; type: string; unitLabel: string | null; applicantName: string | null
  applicantEmailMasked: string | null; emailVerified: boolean
  submitted: boolean; providerLabels: Record<string, string>
  checklist: ChecklistItem[]; rules: { rule_key: string; label: string }[]
}

const wrap: React.CSSProperties = { maxWidth: 640, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }
const field: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box', marginTop: 4 }
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 14, display: 'block' }
const primary = (on: boolean): React.CSSProperties => ({ width: '100%', marginTop: 18, padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: on ? '#f26a1b' : '#9ca3af', border: 'none', borderRadius: 8, cursor: on ? 'pointer' : 'default' })

export default function PreApplyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const [step, setStep] = useState<'type' | 'contact' | 'docs'>('type')
  const [type, setType] = useState<string>('')
  const [form, setForm] = useState({ name: '', email: '', phone: '', unit: '' })
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Prefill from a staff-generated link (e.g. an email reply): ?type=&unit=&name=&email=
  // When the type is known, jump straight to the contact step so the applicant
  // just confirms and uploads.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const qType = q.get('type') ?? ''
    if (TYPES.some(t => t.key === qType)) setType(qType)
    setForm(f => ({ ...f, unit: q.get('unit') ?? f.unit, name: q.get('name') ?? f.name, email: q.get('email') ?? f.email }))
    if (TYPES.some(t => t.key === qType)) setStep('contact')
  }, [])

  async function start() {
    setErr(null)
    if (!type) { setErr('Please choose what you are applying for.'); return }
    if (!form.name.trim() || !form.email.includes('@')) { setErr('Please enter your name and a valid email.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/pre-apply/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, type, role: 'applicant', ...form }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not start')
      setToken(d.token); setStep('docs')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (step === 'docs' && token) return <DocsStep code={code} token={token} />

  return (
    <div style={wrap}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', margin: 0 }}>{code}</p>
      <h1 style={{ fontSize: 22, color: '#1f2a44', margin: '4px 0 2px' }}>Application &amp; Compliance</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>Start your application. You&apos;ll upload the required documents and acknowledge the association&apos;s rules.</p>

      {step === 'type' && (
        <>
          <label style={label}>What are you applying for?</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            {TYPES.map(tp => (
              <button key={tp.key} onClick={() => setType(tp.key)} style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: `1px solid ${type === tp.key ? '#f26a1b' : '#e5e7eb'}`, background: type === tp.key ? '#fff7f0' : '#fff', cursor: 'pointer' }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{tp.title}</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{tp.blurb}</div>
              </button>
            ))}
          </div>
          {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
          <button onClick={() => { if (!type) { setErr('Please choose one.'); return } setErr(null); setStep('contact') }} style={primary(!!type)}>Continue →</button>
        </>
      )}

      {step === 'contact' && (
        <>
          <label style={label}>Your full name<input style={field} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label style={label}>Email<input style={field} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label style={label}>Mobile phone<input style={field} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} inputMode="tel" /></label>
          <label style={label}>Unit number<input style={field} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="e.g. 511" /></label>
          {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
          <button onClick={start} disabled={busy} style={primary(!busy)}>{busy ? 'Starting…' : 'Continue to documents →'}</button>
          <button onClick={() => setStep('type')} style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer' }}>← Back</button>
        </>
      )}
    </div>
  )
}

function DocsStep({ code, token }: { code: string; token: string }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rulesName, setRulesName] = useState('')
  const [sig, setSig] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/pre-apply/${token}`).then(r => r.json()).then(d => { if (d.error) setErr(d.error); else setInfo(d) }).catch(() => setErr('Network error — please reload.'))
  }, [token])
  useEffect(load, [load])

  async function submit() {
    setErr(null)
    if (!agreed) { setErr('Please check the box to acknowledge the rules.'); return }
    if (!rulesName.trim()) { setErr('Please type your name to sign.'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/pre-apply/${token}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rulesName, signatureImage: sig }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not submit')
      setDone(true)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (err && !info) return <div style={wrap}><h2>⚠ {err}</h2></div>
  if (!info) return <div style={wrap}><p>Loading…</p></div>
  if (done || info.submitted) return (
    <div style={wrap}>
      <h1 style={{ color: '#f26a1b' }}>✅ Application submitted</h1>
      <p>Thank you. PMI Top Florida Properties will review your documents and follow up. You do not need to do anything else right now.</p>
      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 18 }}>Questions? PMI Top Florida Properties · (305) 900-5077</p>
    </div>
  )

  const applicantDocs = info.checklist.filter(d => d.provided_by === 'applicant')
  const otherDocs = info.checklist.filter(d => d.provided_by !== 'applicant')
  const requiredDone = info.checklist.every(d => !d.required || d.uploaded)

  // Applicants must verify their email before they can upload anything.
  if (!info.emailVerified) return (
    <div style={wrap}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', margin: 0 }}>{info.associationName}</p>
      <h1 style={{ fontSize: 22, color: '#1f2a44', margin: '4px 0 2px' }}>Verify your email</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>We&apos;ll send a code to {info.applicantEmailMasked ?? 'your email'} to confirm it&apos;s you before you upload documents.</p>
      <VerifyEmail token={token} onVerified={load} />
    </div>
  )

  return (
    <div style={wrap}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', margin: 0 }}>{info.associationName}</p>
      <h1 style={{ fontSize: 22, color: '#1f2a44', margin: '4px 0 2px' }}>Required documents</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>Upload each document below in its own box{info.unitLabel ? ` · Unit ${info.unitLabel}` : ''}.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {applicantDocs.map(d => <DocBox key={d.id} token={token} item={d} onDone={load} />)}
      </div>

      {otherDocs.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, color: '#1f2a44', margin: '20px 0 4px' }}>Provided by the landlord / owner</h2>
          <p style={{ fontSize: 12.5, color: '#6b7280', marginTop: 0 }}>If you have these, upload them; otherwise the owner will be asked separately.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {otherDocs.map(d => <DocBox key={d.id} token={token} item={d} onDone={load} />)}
          </div>
        </>
      )}

      {/* Shown & signed: association rules */}
      <h2 style={{ fontSize: 15, color: '#1f2a44', margin: '22px 0 4px' }}>Association rules — please read &amp; acknowledge</h2>
      {info.rules.length > 0 ? (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          {info.rules.map(r => <li key={r.rule_key}>{r.label}</li>)}
        </ul>
      ) : <p style={{ fontSize: 13, color: '#6b7280' }}>By signing you acknowledge the association&apos;s governing documents, rules, and restrictions.</p>}

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14, fontSize: 13.5, color: '#374151', lineHeight: 1.5 }}>
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I have read and agree to comply with the association&apos;s rules and restrictions, and I certify the documents and information I provided are true and complete.</span>
      </label>
      <label style={label}>Type your full name to sign<input style={field} value={rulesName} onChange={e => setRulesName(e.target.value)} /></label>
      <div style={{ marginTop: 12 }}>
        <label style={{ ...label, marginTop: 0 }}>Draw your signature</label>
        <SignaturePad onChange={img => setSig(img ?? '')} />
      </div>

      {!requiredDone && <p style={{ color: '#92400e', fontSize: 12.5, marginTop: 12 }}>Upload all required documents (marked “Required”) before submitting.</p>}
      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={submit} disabled={busy || !requiredDone} style={primary(!busy && requiredDone)}>{busy ? 'Submitting…' : 'Submit application'}</button>
      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 12, textAlign: 'center' }}>PMI Top Florida Properties · {code}</p>
    </div>
  )
}

function VerifyEmail({ token, onVerified }: { token: string; onVerified: () => void }) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function send() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/pre-apply/${token}/send-otp`, { method: 'POST' })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not send')
      setSent(true); setMsg(`Code sent to ${d.sentTo}.`)
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  async function verify() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/pre-apply/${token}/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not verify')
      onVerified()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  const btn: React.CSSProperties = { padding: '10px 16px', fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer', color: '#fff', background: busy ? '#9ca3af' : '#f26a1b' }
  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={send} disabled={busy} style={btn}>{sent ? 'Resend code' : 'Send me a code'}</button>
      {sent && <>
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" inputMode="numeric" style={{ width: 130, padding: '10px 12px', fontSize: 16, border: '1px solid #d1d5db', borderRadius: 8, letterSpacing: 3 }} />
        <button onClick={verify} disabled={busy || code.length < 4} style={{ ...btn, background: busy || code.length < 4 ? '#9ca3af' : '#059669' }}>Verify</button>
      </>}
      {msg && <p style={{ width: '100%', fontSize: 13, color: msg.startsWith('Code sent') ? '#166534' : '#b91c1c', margin: '4px 0 0' }}>{msg}</p>}
    </div>
  )
}

function DocBox({ token, item, onDone }: { token: string; item: ChecklistItem; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit() {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const u = await fetch(`/api/pre-apply/${token}/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc_key: item.doc_key, filename: file.name }) })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'upload failed')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error('upload failed')
      const s = await fetch(`/api/pre-apply/${token}/record-doc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc_key: item.doc_key, doc_label: item.label, storage_path: uj.path, filename: file.name, mime_type: file.type }) })
      if (!s.ok) throw new Error((await s.json()).error || 'save failed')
      setFile(null); onDone()
    } catch (e) { setMsg(`Could not upload: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ border: `1px solid ${item.uploaded ? '#a7f3d0' : (item.required ? '#fde68a' : '#e5e7eb')}`, background: item.uploaded ? '#ecfdf5' : (item.required ? '#fffbeb' : '#fff'), borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{item.label}</span>
          {!item.required && <span style={{ fontSize: 11, color: '#6b7280' }}> · optional</span>}
          {item.note && <div style={{ fontSize: 12, color: '#6b7280' }}>{item.note}</div>}
        </div>
        {item.uploaded && <span style={{ fontSize: 12.5, color: '#166534', fontWeight: 600 }}>✓ Uploaded</span>}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
        <button onClick={submit} disabled={!file || busy} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: !file || busy ? 'default' : 'pointer', background: !file || busy ? '#d1d5db' : '#f26a1b', color: '#fff', fontSize: 13, fontWeight: 700 }}>{busy ? 'Uploading…' : item.uploaded ? 'Replace' : 'Upload'}</button>
      </div>
      {msg && <p style={{ fontSize: 12, color: '#991b1b', margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}
