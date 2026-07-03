'use client'

// =====================================================================
// LedgerRequestButton.tsx
//
// Portal "Get my account statement" quick action. The resident is already
// logged in (passkey/OTP session), but a fresh second factor is required
// before handing out a financial document — emails a 6-digit code, then
// on verification emails the secure statement link. Owner-only; hidden
// entirely when the account is in collections (AssociationPortal checks
// that before rendering this).
// =====================================================================

import { useState } from 'react'

type Step = 'idle' | 'sending' | 'awaiting_code' | 'verifying' | 'done'

export default function LedgerRequestButton({ assocCode }: { assocCode: string }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [masked, setMasked] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setStep('idle'); setCode(''); setErr(null)
  }

  async function sendCode() {
    setStep('sending'); setErr(null)
    try {
      const res = await fetch('/api/owner/ledger-web/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assocCode }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(
        d?.error === 'collections' ? 'Your account is currently with our collection agency — please contact them directly.' :
        d?.error === 'no_email' ? "We don't have an email on file for your account. Please contact ar@topfloridaproperties.com." :
        "Couldn't send a code right now. Please try again shortly."
      )
      setMasked(d.masked ?? 'your email')
      setStep('awaiting_code')
    } catch (e) { setErr((e as Error).message); setStep('idle') }
  }

  async function verifyAndSend() {
    if (!code.trim()) { setErr('Enter the code we emailed you.'); return }
    setStep('verifying'); setErr(null)
    try {
      const res = await fetch('/api/owner/ledger-web/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assocCode, code: code.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(
        d?.error === 'invalid_code' ? "That code didn't match. Please try again." :
        d?.error === 'collections' ? 'Your account is currently with our collection agency — please contact them directly.' :
        "Couldn't send your statement right now. Please try again shortly."
      )
      setStep('done')
    } catch (e) { setErr((e as Error).message); setStep('awaiting_code') }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="prow"
        style={{ width: '100%', textAlign: 'left', font: 'inherit' }}
      >
        <div className="prow-orb">📄</div>
        <div className="prow-info">
          <div className="prow-t">Account Statement</div>
          <div className="prow-d">Get your current ledger by email</div>
        </div>
        <div className="prow-btn">Get it</div>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Get my account statement"
          onClick={close}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(13,13,13,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--card, #fff)', borderRadius: 6, border: '1px solid var(--border)', maxWidth: 420, width: '100%', padding: '1.6rem 1.5rem 1.5rem', boxShadow: '0 20px 60px rgba(13,13,13,.35)', position: 'relative' }}
          >
            <button type="button" onClick={close} aria-label="Close" style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1, color: 'var(--muted)' }}>&times;</button>

            <div style={{ textAlign: 'center', fontSize: '2.2rem', lineHeight: 1 }}>📄</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 400, textAlign: 'center', margin: '0.6rem 0 0.25rem', color: 'var(--navy)' }}>
              Account Statement
            </h3>

            {step === 'done' ? (
              <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.9rem', marginTop: '1rem' }}>
                ✅ Sent! Check your email — the secure link works for 7 days.
              </p>
            ) : step === 'awaiting_code' || step === 'verifying' ? (
              <>
                <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>
                  We emailed a 6-digit code to {masked}. Enter it below to confirm it&apos;s you.
                </p>
                <input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="6-digit code"
                  inputMode="numeric"
                  maxLength={6}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '0.7rem 0.9rem', border: '1px solid var(--border)', borderRadius: 6, fontSize: '1.1rem', textAlign: 'center', letterSpacing: '0.2em', marginBottom: '0.75rem' }}
                />
                {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', textAlign: 'center', marginBottom: '0.75rem' }}>⚠ {err}</p>}
                <button
                  type="button" onClick={verifyAndSend} disabled={step === 'verifying'}
                  style={{ width: '100%', background: '#f26a1b', color: '#fff', border: 'none', borderRadius: 6, padding: '0.75rem', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', opacity: step === 'verifying' ? 0.6 : 1 }}
                >
                  {step === 'verifying' ? 'Verifying…' : 'Verify & Send Statement'}
                </button>
              </>
            ) : (
              <>
                <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.82rem', margin: '0 0 1.25rem' }}>
                  For your security, we&apos;ll email a 6-digit code to confirm it&apos;s you before sending your statement.
                </p>
                {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', textAlign: 'center', marginBottom: '0.75rem' }}>⚠ {err}</p>}
                <button
                  type="button" onClick={sendCode} disabled={step === 'sending'}
                  style={{ width: '100%', background: '#f26a1b', color: '#fff', border: 'none', borderRadius: 6, padding: '0.75rem', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', opacity: step === 'sending' ? 0.6 : 1 }}
                >
                  {step === 'sending' ? 'Sending…' : 'Send my code'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
