'use client'

// =====================================================================
// PasskeyEnrollPrompt.tsx
//
// Shown ONCE right after a resident signs in with their phone-OTP code
// (text / WhatsApp). Because they're authenticated at that moment, this is
// the easy moment to offer Face ID / fingerprint enrollment — no hunting for
// an account menu. Works for every persona (owner/board/tenant/staff), not
// just owners. It self-resolves (calls onDone → the normal redirect) when:
//   • the browser has no WebAuthn, or
//   • the user already has a passkey, or
//   • the user previously tapped "Not now" (remembered locally).
// English-only per the durable-artifact rule. Never blocks login.
// =====================================================================

import { useEffect, useState } from 'react'
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'

const DECLINED_KEY = 'maia_pk_declined'

export default function PasskeyEnrollPrompt({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<'checking' | 'ask' | 'busy' | 'done'>('checking')

  // Decide whether to even show the prompt.
  useEffect(() => {
    let live = true
    const finish = () => { if (live) { setStage('done'); onDone() } }
    ;(async () => {
      if (!browserSupportsWebAuthn()) return finish()
      try { if (localStorage.getItem(DECLINED_KEY) === '1') return finish() } catch { /* ignore */ }
      try {
        const r = await fetch('/api/auth/passkey/list')
        const d = await r.json()
        if (!live) return
        if ((d.passkeys?.length ?? 0) > 0) return finish()   // already enrolled
      } catch { /* show the prompt anyway */ }
      if (live) setStage('ask')
    })()
    return () => { live = false }
  }, [onDone])

  async function enable() {
    setStage('busy')
    try {
      const optRes = await fetch('/api/auth/passkey/register/options', { method: 'POST' })
      if (!optRes.ok) throw new Error('start')
      const options = await optRes.json()
      try {
        const att = await startRegistration({ optionsJSON: options })
        const vRes = await fetch('/api/auth/passkey/register/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: att }),
        })
        // Success (or 409 = already enrolled on this device) → remember so the
        // landing "Sign in with Face ID" button starts showing.
        if (vRes.ok || vRes.status === 409) { try { localStorage.setItem('maia_pk_enrolled', '1') } catch { /* ignore */ } }
      } catch { /* cancelled or device error — don't block login */ }
    } catch { /* options failed — don't block login */ }
    onDone()
  }

  function notNow() {
    try { localStorage.setItem(DECLINED_KEY, '1') } catch { /* ignore */ }
    onDone()
  }

  if (stage === 'checking' || stage === 'done') return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(13,13,13,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}>
      <div style={{ background: '#fff', borderRadius: 14, maxWidth: 380, width: '100%', padding: '1.75rem 1.5rem', boxShadow: '0 20px 60px rgba(13,13,13,.35)', textAlign: 'center' }}>
        <div style={{ fontSize: '2.6rem', lineHeight: 1 }}>📱</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 400, color: '#0f172a', margin: '0.65rem 0 0.4rem' }}>
          Set up Face ID / fingerprint?
        </h2>
        <p style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
          Skip the text code next time — sign in instantly with Face ID, Touch ID, or your fingerprint. Your phone number will always still work.
        </p>
        <button
          onClick={enable}
          disabled={stage === 'busy'}
          style={{ width: '100%', background: '#f26a1b', color: '#fff', border: 'none', borderRadius: 8, padding: '0.8rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', opacity: stage === 'busy' ? 0.6 : 1 }}
        >
          {stage === 'busy' ? 'Setting up…' : 'Enable Face ID / fingerprint'}
        </button>
        <button
          onClick={notNow}
          disabled={stage === 'busy'}
          style={{ width: '100%', background: 'none', color: '#64748b', border: 'none', padding: '0.7rem', fontSize: '0.82rem', cursor: 'pointer', marginTop: '0.25rem' }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
