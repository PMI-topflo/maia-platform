'use client'

// =====================================================================
// PasskeySettings.tsx
//
// Account-settings surface (shown AFTER the resident is signed in via
// phone-OTP): enable Face ID / fingerprint sign-in, and list/remove the
// passkeys on file. English-only per the durable-artifact rule.
// =====================================================================

import { useEffect, useState } from 'react'
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'

interface Passkey { id: string; friendly_name: string | null; created_at: string; last_used_at: string | null }

const fmt = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

export default function PasskeySettings() {
  const [supported, setSupported] = useState(false)
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { setSupported(browserSupportsWebAuthn()); refresh() }, [])

  async function refresh() {
    try {
      const r = await fetch('/api/auth/passkey/list'); const d = await r.json()
      setPasskeys(d.passkeys ?? [])
      // Keep the device flag honest: if the account has no passkeys at all,
      // clear it so the landing "Sign in with Face ID" button hides again.
      if ((d.passkeys?.length ?? 0) === 0) { try { localStorage.removeItem('maia_pk_enrolled') } catch { /* ignore */ } }
    } catch { setPasskeys([]) }
  }

  async function enroll() {
    setBusy(true); setMsg(null)
    try {
      const optRes = await fetch('/api/auth/passkey/register/options', { method: 'POST' })
      if (!optRes.ok) throw new Error('Could not start enrollment. Please try again.')
      const options = await optRes.json()

      let attestation
      try {
        attestation = await startRegistration({ optionsJSON: options })
      } catch (e) {
        if ((e as { name?: string })?.name === 'NotAllowedError') { setMsg({ kind: 'err', text: 'Setup was cancelled.' }); return }
        throw new Error('Your device could not create a passkey.')
      }

      const vRes = await fetch('/api/auth/passkey/register/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: attestation }),
      })
      const vd = await vRes.json()
      if (vRes.status === 409 || vd?.error === 'webauthn_credential_exists') {
        try { localStorage.setItem('maia_pk_enrolled', '1') } catch { /* ignore */ }
        setMsg({ kind: 'ok', text: 'This device already has a passkey set up.' }); await refresh(); return
      }
      if (!vRes.ok) throw new Error('Enrollment failed. Please try again.')
      try { localStorage.setItem('maia_pk_enrolled', '1') } catch { /* ignore */ }
      setMsg({ kind: 'ok', text: `Face ID / fingerprint sign-in is on${vd?.passkey?.friendly_name ? ` — ${vd.passkey.friendly_name}` : ''}.` })
      await refresh()
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error)?.message ?? 'Something went wrong.' })
    } finally { setBusy(false) }
  }

  async function remove(id: string, name: string | null) {
    if (!window.confirm(`Remove ${name || 'this passkey'}? You can set it up again anytime.`)) return
    await fetch('/api/auth/passkey/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passkeyId: id }) }).catch(() => null)
    await refresh()
  }

  if (!supported) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Face ID / fingerprint sign-in</h3>
      <p className="mt-1 text-xs text-gray-500">Skip the text code next time — sign in with your device&rsquo;s Face ID, Touch ID, or fingerprint. Your phone number still works too.</p>

      <button
        onClick={enroll}
        disabled={busy}
        className="mt-3 rounded bg-[#f26a1b] px-3 py-2 text-xs font-semibold text-white hover:bg-[#f58140] disabled:opacity-50"
      >
        {busy ? 'Setting up…' : 'Enable Face ID / fingerprint sign-in'}
      </button>

      {msg && (
        <div className={`mt-2 text-xs ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{msg.kind === 'ok' ? '✓ ' : '⚠ '}{msg.text}</div>
      )}

      {passkeys && passkeys.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Your passkeys</div>
          <ul className="mt-2 space-y-1.5">
            {passkeys.map(pk => (
              <li key={pk.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-700">
                  🔑 {pk.friendly_name || 'Passkey'}
                  <span className="text-gray-400">
                    {' · added '}{fmt(pk.created_at)}{pk.last_used_at ? ` · last used ${fmt(pk.last_used_at)}` : ''}
                  </span>
                </span>
                <button onClick={() => remove(pk.id, pk.friendly_name)} className="shrink-0 text-red-500 hover:underline">Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
