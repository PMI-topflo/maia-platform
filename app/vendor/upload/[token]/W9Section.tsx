'use client'

import { useEffect, useState } from 'react'

// IRS Form W-9 certification (Part II) — kept in English (US tax form).
const CERT = 'Under penalties of perjury, I certify that the number shown is my correct taxpayer identification number, that I am not subject to backup withholding, that I am a U.S. person, and that any FATCA code entered is correct. I accept full responsibility for the accuracy of this information.'

const CLASSES = ['individual', 'c_corp', 's_corp', 'partnership', 'trust_estate', 'llc', 'other'] as const

const STR = {
  en: {
    heading: 'Tax information (W-9)',
    onFileIntro: 'This is the tax ID we have on file for you. Please confirm it has not changed.',
    name: 'Name on file', taxId: 'Tax ID',
    confirmBtn: 'Confirm — unchanged', changedBtn: 'It changed — update it',
    entryIntro: 'Provide your taxpayer information (Substitute Form W-9) so we can pay you and issue your 1099.',
    legalPh: 'Legal name (as shown on your tax return)', businessPh: 'Business name / DBA (optional)',
    classLabel: 'Federal tax classification',
    classes: { individual: 'Individual / sole proprietor', c_corp: 'C corporation', s_corp: 'S corporation', partnership: 'Partnership', trust_estate: 'Trust / estate', llc: 'LLC', other: 'Other' },
    ein: 'EIN', ssn: 'SSN', tinPh: '9-digit tax ID number',
    review: 'Review', back: 'Back',
    reviewIntro: 'Please review the information you entered. You are responsible for its accuracy.',
    namePh: 'Your full name', titlePh: 'Your title (e.g. Owner, Manager)',
    certifyLabel: CERT,
    submit: 'Certify & submit', submitting: 'Submitting…',
    doneConfirm: 'Thank you — we have recorded that your tax ID is unchanged.',
    doneUpdate: 'Thank you — your W-9 was received. PMI will apply your tax ID to your vendor record.',
    errLegal: 'Enter your legal name.', errClass: 'Select a tax classification.',
    errTin: 'Enter a valid 9-digit tax ID.', errName: 'Enter your full name.', errTitle: 'Enter your title.',
    errCertify: 'You must certify the information.',
    none: 'We do not have your tax ID on file yet.',
  },
  es: {
    heading: 'Información fiscal (W-9)',
    onFileIntro: 'Este es el número de identificación fiscal que tenemos registrado. Confirme que no ha cambiado.',
    name: 'Nombre registrado', taxId: 'ID fiscal',
    confirmBtn: 'Confirmar — sin cambios', changedBtn: 'Cambió — actualizar',
    entryIntro: 'Proporcione su información fiscal (Formulario W-9 sustituto) para poder pagarle y emitir su 1099.',
    legalPh: 'Nombre legal (como aparece en su declaración)', businessPh: 'Nombre comercial / DBA (opcional)',
    classLabel: 'Clasificación fiscal federal',
    classes: { individual: 'Individuo / propietario único', c_corp: 'Corporación C', s_corp: 'Corporación S', partnership: 'Sociedad', trust_estate: 'Fideicomiso / sucesión', llc: 'LLC', other: 'Otro' },
    ein: 'EIN', ssn: 'SSN', tinPh: 'Número de ID fiscal (9 dígitos)',
    review: 'Revisar', back: 'Atrás',
    reviewIntro: 'Revise la información ingresada. Usted es responsable de su exactitud.',
    namePh: 'Su nombre completo', titlePh: 'Su cargo (p. ej. Dueño, Gerente)',
    certifyLabel: CERT,
    submit: 'Certificar y enviar', submitting: 'Enviando…',
    doneConfirm: 'Gracias — registramos que su ID fiscal no ha cambiado.',
    doneUpdate: 'Gracias — recibimos su W-9. PMI aplicará su ID fiscal a su registro de proveedor.',
    errLegal: 'Ingrese su nombre legal.', errClass: 'Seleccione una clasificación fiscal.',
    errTin: 'Ingrese un ID fiscal válido de 9 dígitos.', errName: 'Ingrese su nombre completo.', errTitle: 'Ingrese su cargo.',
    errCertify: 'Debe certificar la información.',
    none: 'Todavía no tenemos su ID fiscal registrado.',
  },
} as const

interface Status { hasVendor: boolean; onFile: boolean; vendorName?: string | null; checkName?: string | null; taxIdLast4?: string | null }

export default function W9Section({ token, lang = 'en', apiBase }: { token: string; lang?: string; apiBase?: string }) {
  const base = apiBase ?? `/api/vendor/upload/${token}`
  const t = STR[(lang === 'es' ? 'es' : 'en')]
  const [phase, setPhase] = useState<'loading' | 'status' | 'entry' | 'review' | 'done'>('loading')
  const [status, setStatus] = useState<Status | null>(null)
  const [doneMsg, setDoneMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [legalName, setLegalName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [classification, setClassification] = useState<typeof CLASSES[number]>('individual')
  const [tinType, setTinType] = useState<'ein' | 'ssn'>('ein')
  const [tin, setTin] = useState('')
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [certify, setCertify] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${base}/w9`)
      .then(r => r.json())
      .then((s: Status) => { if (!alive) return; setStatus(s); setPhase(s.onFile ? 'status' : 'entry') })
      .catch(() => { if (alive) setPhase('entry') })
    return () => { alive = false }
  }, [base])

  async function confirmUnchanged() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${base}/w9`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', taxIdLast4: status?.taxIdLast4 }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'failed')
      setDoneMsg(t.doneConfirm); setPhase('done')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  function toReview() {
    setError(null)
    if (!legalName.trim()) { setError(t.errLegal); return }
    if (tin.replace(/\D/g, '').length !== 9) { setError(t.errTin); return }
    setPhase('review')
  }

  async function submitUpdate() {
    setError(null)
    if (!name.trim()) { setError(t.errName); return }
    if (!title.trim()) { setError(t.errTitle); return }
    if (!certify) { setError(t.errCertify); return }
    setBusy(true)
    try {
      const res = await fetch(`${base}/w9`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update', legalName: legalName.trim(), businessName: businessName.trim() || undefined, classification, tinType, tin, authorizedName: name.trim(), authorizedTitle: title.trim(), certify: true }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'failed')
      setDoneMsg(t.doneUpdate); setPhase('done')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (phase === 'loading') return <div style={{ fontSize: 13, color: '#6b7280', padding: 12 }}>…</div>

  if (phase === 'done') return (
    <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46' }}>✓ {doneMsg}</div>
  )

  if (phase === 'status' && status?.onFile) return (
    <div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '0 0 12px' }}>{t.onFileIntro}</p>
      <div style={card}>
        <Row label={t.name} value={status.checkName ?? '—'} />
        <Row label={t.taxId} value={`••••${status.taxIdLast4 ?? '----'}`} />
      </div>
      {error && <div style={errStyle}>⚠ {error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={confirmUnchanged} disabled={busy} style={primaryBtn}>{busy ? t.submitting : t.confirmBtn}</button>
        <button onClick={() => { setPhase('entry'); setError(null) }} disabled={busy} style={secondaryBtn}>{t.changedBtn}</button>
      </div>
    </div>
  )

  if (phase === 'review') return (
    <div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '0 0 12px' }}>{t.reviewIntro}</p>
      <div style={card}>
        <Row label={t.legalPh.split(' (')[0]} value={legalName.trim() || '—'} />
        {businessName.trim() && <Row label="Business" value={businessName.trim()} />}
        <Row label={t.classLabel} value={t.classes[classification]} />
        <Row label={tinType === 'ssn' ? t.ssn : t.ein} value={`••••${tin.replace(/\D/g, '').slice(-4)}`} />
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder={t.namePh} style={input} />
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t.titlePh} style={input} />
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: '#374151', margin: '4px 0 12px', lineHeight: 1.4 }}>
        <input type="checkbox" checked={certify} onChange={e => setCertify(e.target.checked)} style={{ marginTop: 2 }} />
        <span>{t.certifyLabel}</span>
      </label>
      {error && <div style={errStyle}>⚠ {error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setPhase(status?.onFile ? 'status' : 'entry'); setError(null) }} disabled={busy} style={secondaryBtn}>{t.back}</button>
        <button onClick={submitUpdate} disabled={busy} style={primaryBtn}>{busy ? t.submitting : t.submit}</button>
      </div>
    </div>
  )

  // entry
  return (
    <div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '0 0 12px' }}>{status && !status.onFile && status.hasVendor ? t.none + ' ' : ''}{t.entryIntro}</p>
      <input value={legalName} onChange={e => setLegalName(e.target.value)} placeholder={t.legalPh} style={input} />
      <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder={t.businessPh} style={input} />
      <label style={fieldLabel}>{t.classLabel}</label>
      <select value={classification} onChange={e => setClassification(e.target.value as typeof CLASSES[number])} style={{ ...input, background: '#fff' }}>
        {CLASSES.map(c => <option key={c} value={c}>{t.classes[c]}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {(['ein', 'ssn'] as const).map(k => (
          <button key={k} onClick={() => setTinType(k)} style={{
            flex: 1, padding: '8px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: tinType === k ? '1px solid #f26a1b' : '1px solid #d1d5db',
            background: tinType === k ? '#fff7ed' : '#fff', color: tinType === k ? '#c2410c' : '#374151',
          }}>{k === 'ssn' ? t.ssn : t.ein}</button>
        ))}
      </div>
      <input value={tin} onChange={e => setTin(e.target.value)} placeholder={t.tinPh} inputMode="numeric" style={input} />
      {error && <div style={errStyle}>⚠ {error}</div>}
      <button onClick={toReview} style={primaryBtn}>{t.review} →</button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: '1px solid #f1f5f9', fontSize: 13 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{value}</span>
    </div>
  )
}

const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 12px', background: '#f9fafb' }
const input: React.CSSProperties = { width: '100%', padding: '9px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 10, boxSizing: 'border-box' }
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '4px 0' }
const errStyle: React.CSSProperties = { fontSize: 13, color: '#991b1b', margin: '4px 0 10px' }
const primaryBtn: React.CSSProperties = { flex: 1, padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700 }
const secondaryBtn: React.CSSProperties = { flex: 1, padding: '11px', borderRadius: 8, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600 }
