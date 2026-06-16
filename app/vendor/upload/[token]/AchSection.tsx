'use client'

import { useEffect, useState } from 'react'

// Legal authorization text — kept in English (US banking authorization).
const CERT = 'I certify that I am authorized to provide these banking details on behalf of the vendor, that the information is accurate and current, and that I accept full responsibility for it. I authorize PMI Top Florida Properties to set up ACH / direct-deposit payments to this account until I notify PMI in writing of a change.'

const STR = {
  en: {
    heading: 'Direct deposit (ACH)',
    onFileIntro: 'This is the bank account we have on file for your payments. Please confirm it has not changed.',
    bank: 'Bank', routing: 'Routing number', account: 'Account', type: 'Account type',
    checking: 'Checking', savings: 'Savings',
    confirmBtn: 'Confirm — unchanged', changedBtn: 'It changed — update it',
    entryIntro: 'Enter your bank details for direct-deposit (ACH) payments.',
    bankPh: 'Bank name (optional — we can look it up)',
    routingPh: '9-digit routing number', accountPh: 'Account number', account2Ph: 'Re-enter account number',
    review: 'Review', back: 'Back',
    reviewIntro: 'Please review the information you entered. You are responsible for its accuracy.',
    namePh: 'Your full name', titlePh: 'Your title (e.g. Owner, Manager)',
    certifyLabel: CERT,
    submit: 'Confirm & submit', submitting: 'Submitting…',
    doneConfirm: 'Thank you — we have recorded that your bank account is unchanged.',
    doneUpdate: 'Thank you — your banking authorization was received. PMI will apply it to your vendor record.',
    errRouting: 'Enter a valid 9-digit routing number.',
    errAccount: 'Enter your account number.',
    errMatch: 'The account numbers do not match.',
    errName: 'Enter your full name.', errTitle: 'Enter your title.', errCertify: 'Please confirm you are responsible for the information.',
    none: 'We do not have direct-deposit banking on file for you yet.',
  },
  es: {
    heading: 'Depósito directo (ACH)',
    onFileIntro: 'Esta es la cuenta bancaria que tenemos registrada para sus pagos. Confirme que no ha cambiado.',
    bank: 'Banco', routing: 'Número de ruta', account: 'Cuenta', type: 'Tipo de cuenta',
    checking: 'Corriente', savings: 'Ahorros',
    confirmBtn: 'Confirmar — sin cambios', changedBtn: 'Cambió — actualizar',
    entryIntro: 'Ingrese los datos de su banco para pagos por depósito directo (ACH).',
    bankPh: 'Nombre del banco (opcional — podemos buscarlo)',
    routingPh: 'Número de ruta (9 dígitos)', accountPh: 'Número de cuenta', account2Ph: 'Repita el número de cuenta',
    review: 'Revisar', back: 'Atrás',
    reviewIntro: 'Revise la información ingresada. Usted es responsable de su exactitud.',
    namePh: 'Su nombre completo', titlePh: 'Su cargo (p. ej. Dueño, Gerente)',
    certifyLabel: CERT,
    submit: 'Confirmar y enviar', submitting: 'Enviando…',
    doneConfirm: 'Gracias — registramos que su cuenta bancaria no ha cambiado.',
    doneUpdate: 'Gracias — recibimos su autorización bancaria. PMI la aplicará a su registro de proveedor.',
    errRouting: 'Ingrese un número de ruta válido de 9 dígitos.',
    errAccount: 'Ingrese su número de cuenta.',
    errMatch: 'Los números de cuenta no coinciden.',
    errName: 'Ingrese su nombre completo.', errTitle: 'Ingrese su cargo.', errCertify: 'Confirme que es responsable de la información.',
    none: 'Todavía no tenemos datos bancarios de depósito directo para usted.',
  },
} as const

function validRouting(rn: string): boolean {
  const d = rn.replace(/\D/g, '')
  if (d.length !== 9) return false
  const n = d.split('').map(Number)
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0
}

interface Status { hasVendor: boolean; onFile: boolean; vendorName?: string | null; bankName?: string | null; routing?: string | null; accountLast4?: string | null; accountType?: string | null }

export default function AchSection({ token, lang = 'en', apiBase }: { token: string; lang?: string; apiBase?: string }) {
  const base = apiBase ?? `/api/vendor/upload/${token}`
  const t = STR[(lang === 'es' ? 'es' : 'en')]
  const [phase, setPhase] = useState<'loading' | 'status' | 'entry' | 'review' | 'done'>('loading')
  const [status, setStatus] = useState<Status | null>(null)
  const [doneMsg, setDoneMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // entry fields
  const [bankName, setBankName] = useState('')
  const [routing, setRouting] = useState('')
  const [account, setAccount] = useState('')
  const [account2, setAccount2] = useState('')
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking')
  // review fields
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [certify, setCertify] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${base}/ach`)
      .then(r => r.json())
      .then((s: Status) => { if (!alive) return; setStatus(s); setPhase(s.onFile ? 'status' : 'entry') })
      .catch(() => { if (alive) setPhase('entry') })
    return () => { alive = false }
  }, [base])

  async function confirmUnchanged() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${base}/ach`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', accountLast4: status?.accountLast4 }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'failed')
      setDoneMsg(t.doneConfirm); setPhase('done')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  function toReview() {
    setError(null)
    if (!validRouting(routing)) { setError(t.errRouting); return }
    if (account.replace(/\D/g, '').length < 4) { setError(t.errAccount); return }
    if (account.replace(/\D/g, '') !== account2.replace(/\D/g, '')) { setError(t.errMatch); return }
    setPhase('review')
  }

  async function submitUpdate() {
    setError(null)
    if (!name.trim()) { setError(t.errName); return }
    if (!title.trim()) { setError(t.errTitle); return }
    if (!certify) { setError(t.errCertify); return }
    setBusy(true)
    try {
      const res = await fetch(`${base}/ach`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update', bankName: bankName.trim() || undefined, routing, account, accountType, authorizedName: name.trim(), authorizedTitle: title.trim(), certify: true }),
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
        <Row label={t.bank} value={status.bankName ?? '—'} />
        <Row label={t.routing} value={status.routing ?? '—'} />
        <Row label={t.account} value={`••••${status.accountLast4 ?? '----'}`} />
        <Row label={t.type} value={status.accountType === 'savings' ? t.savings : t.checking} />
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
        <Row label={t.bank} value={bankName.trim() || '—'} />
        <Row label={t.routing} value={routing.replace(/\D/g, '')} />
        <Row label={t.account} value={`••••${account.replace(/\D/g, '').slice(-4)}`} />
        <Row label={t.type} value={accountType === 'savings' ? t.savings : t.checking} />
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
      <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder={t.bankPh} style={input} />
      <input value={routing} onChange={e => setRouting(e.target.value)} placeholder={t.routingPh} inputMode="numeric" style={input} />
      <input value={account} onChange={e => setAccount(e.target.value)} placeholder={t.accountPh} inputMode="numeric" style={input} />
      <input value={account2} onChange={e => setAccount2(e.target.value)} placeholder={t.account2Ph} inputMode="numeric" style={input} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['checking', 'savings'] as const).map(k => (
          <button key={k} onClick={() => setAccountType(k)} style={{
            flex: 1, padding: '8px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: accountType === k ? '1px solid #f26a1b' : '1px solid #d1d5db',
            background: accountType === k ? '#fff7ed' : '#fff', color: accountType === k ? '#c2410c' : '#374151',
          }}>{k === 'savings' ? t.savings : t.checking}</button>
        ))}
      </div>
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
const errStyle: React.CSSProperties = { fontSize: 13, color: '#991b1b', margin: '4px 0 10px' }
const primaryBtn: React.CSSProperties = { flex: 1, padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700 }
const secondaryBtn: React.CSSProperties = { flex: 1, padding: '11px', borderRadius: 8, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600 }
