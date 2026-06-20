'use client'

// =====================================================================
// PasskeyLoginButton.tsx
//
// "Sign in with Face ID / fingerprint" on the login screen, alongside the
// phone-OTP entry. Uses discoverable credentials (no email/phone first). On
// success it re-mints the same maia_session and routes to the same
// destination as OTP. Falls back silently to OTP on any failure. English-only.
// =====================================================================

import { useEffect, useState } from 'react'
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'

export default function PasskeyLoginButton() {
  const [supported, setSupported] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setSupported(browserSupportsWebAuthn()) }, [])

  async function signIn() {
    setBusy(true); setErr(null)
    try {
      const optRes = await fetch('/api/auth/passkey/login/options', { method: 'POST' })
      if (!optRes.ok) throw new Error('start')
      const options = await optRes.json()

      let assertion
      try {
        assertion = await startAuthentication({ optionsJSON: options })
      } catch (e) {
        // User cancelled or no passkey on this device → fall back to OTP quietly.
        if ((e as { name?: string })?.name === 'NotAllowedError') { setErr('No passkey found on this device. Use your phone number below.'); return }
        throw e
      }

      const vRes = await fetch('/api/auth/passkey/login/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: assertion }),
      })
      const vd = await vRes.json()
      if (vd?.error === 'webauthn_credential_not_found') { setErr('We don’t recognize that passkey. Use your phone number below.'); return }
      if (vd?.error === 'webauthn_challenge_expired') { setErr('That took too long — please try again.'); return }
      if (!vRes.ok || !vd?.ok) { setErr('Could not sign in with passkey. Use your phone number below.'); return }
      window.location.href = vd.redirect || '/'
    } catch {
      setErr('Could not sign in with passkey. Use your phone number below.')
    } finally { setBusy(false) }
  }

  if (!supported) return null

  return (
    <div>
      <button
        onClick={signIn}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#f26a1b] bg-white px-4 py-2.5 text-sm font-semibold text-[#f26a1b] transition-colors hover:bg-[#fff7f2] disabled:opacity-50"
      >
        <span aria-hidden>🔓</span>{busy ? 'Authenticating…' : 'Sign in with Face ID / fingerprint'}
      </button>
      {err && <p className="mt-1.5 text-center text-xs text-red-500">{err}</p>}
    </div>
  )
}
