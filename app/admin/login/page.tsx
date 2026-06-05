'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'

type Step = 'email' | 'code' | 'success'

const inputCls = 'w-full bg-[#1a1a1a] border border-[#333] text-white placeholder:text-[#555] rounded-[2px] px-3 py-2.5 text-sm focus:outline-none focus:border-[#f26a1b] focus:shadow-[0_0_0_3px_rgba(242,106,27,.18)] transition-shadow'
const labelCls = 'block mb-1 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-[#9ca3af] [font-family:var(--font-mono)]'

// Where to land after auth: honor ?return= when it's a safe internal /admin
// deep link (e.g. a ticket link from a MAIA email), else the dashboard.
function postLoginDest(): string {
  if (typeof window === 'undefined') return '/admin'
  const raw = new URLSearchParams(window.location.search).get('return')
  if (raw && raw.startsWith('/admin') && !raw.startsWith('//') && !raw.startsWith('/admin/login')) {
    return raw
  }
  return '/admin'
}

export default function AdminLoginPage() {
  const [step,     setStep]     = useState<Step>('email')
  const [email,    setEmail]    = useState('')
  const [code,     setCode]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const [cooldown, setCooldown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Already logged in? Go straight to /admin
  useEffect(() => {
    fetch('/api/auth/check-session')
      .then(r => r.json())
      .then((d: { valid: boolean; session?: { persona: string } }) => {
        if (d.valid && d.session?.persona === 'staff') {
          window.location.replace(postLoginDest())
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    timerRef.current = setInterval(() => setCooldown(c => {
      if (c <= 1) { clearInterval(timerRef.current!); return 0 }
      return c - 1
    }), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [cooldown])

  async function sendCode() {
    const id = email.trim()
    if (!id.includes('@') || id.length < 5) { setError('Please enter your PMI staff email address'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, method: 'email', persona: 'staff', roleData: { type: 'staff' } }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to send code'); return }
      setStep('code'); setCooldown(60)
    } catch { setError('Network error — please try again') } finally { setBusy(false) }
  }

  async function verifyCode() {
    const trimmed = code.trim()
    if (trimmed.length !== 6) { setError('Enter the full 6-digit code'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email.trim(), code: trimmed, persona: 'staff', roleData: { type: 'staff' } }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Incorrect code'); return }
      setStep('success')
      setTimeout(() => { window.location.replace(postLoginDest()) }, 900)
    } catch { setError('Network error — please try again') } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image src="/pmi-logo-white.png" alt="PMI Top Florida" width={140} height={44} style={{ objectFit: 'contain' }} priority />
        </div>

        <div className="bg-[#111] border border-[#222] rounded-[4px] p-8">

          {step === 'success' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-14 h-14 rounded-full bg-[#4ade80]/10 flex items-center justify-center border border-[#4ade80]/20">
                <span className="text-3xl text-[#4ade80]">✓</span>
              </div>
              <p className="text-white font-semibold">Identity Verified</p>
              <p className="text-[0.75rem] text-[#9ca3af] font-mono">Redirecting to dashboard…</p>
            </div>
          )}

          {step === 'email' && (
            <>
              <div className="mb-6">
                <div className="text-[0.6rem] font-mono uppercase tracking-[0.15em] text-[#f26a1b] mb-1">Staff Access</div>
                <h1 className="text-lg font-light text-white [font-family:var(--font-display)]">PMI Staff Login</h1>
                <p className="text-[0.78rem] text-[#6b7280] mt-1">Enter your staff email to receive a verification code.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Email Address</label>
                  <input
                    className={inputCls}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendCode() }}
                    placeholder="you@topfloridaproperties.com"
                    autoFocus
                  />
                </div>
                {error && <p className="text-[0.72rem] text-red-400">{error}</p>}
                <button
                  onClick={sendCode}
                  disabled={busy}
                  className="w-full bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white [font-family:var(--font-mono)] text-[0.62rem] font-medium uppercase tracking-[0.08em] py-2.5 px-4 rounded-[2px] transition-colors"
                >
                  {busy ? 'Sending…' : 'Send Verification Code'}
                </button>
              </div>
            </>
          )}

          {step === 'code' && (
            <>
              <div className="mb-6">
                <div className="text-[0.6rem] font-mono uppercase tracking-[0.15em] text-[#f26a1b] mb-1">Step 2 of 2</div>
                <h1 className="text-lg font-light text-white [font-family:var(--font-display)]">Enter Your Code</h1>
                <p className="text-[0.78rem] text-[#6b7280] mt-1">
                  Code sent to <span className="text-white">{email}</span>
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={labelCls}>6-Digit Code</label>
                  <input
                    className={`${inputCls} text-center text-2xl tracking-[0.5em] font-mono`}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={e => { if (e.key === 'Enter') verifyCode() }}
                    placeholder="· · · · · ·"
                    inputMode="numeric"
                    dir="ltr"
                    autoFocus
                  />
                </div>
                {error && <p className="text-[0.72rem] text-red-400">{error}</p>}
                <button
                  onClick={verifyCode}
                  disabled={busy || code.length !== 6}
                  className="w-full bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white [font-family:var(--font-mono)] text-[0.62rem] font-medium uppercase tracking-[0.08em] py-2.5 px-4 rounded-[2px] transition-colors"
                >
                  {busy ? 'Verifying…' : 'Verify & Enter Dashboard'}
                </button>
                <div className="flex items-center justify-between text-[0.65rem] [font-family:var(--font-mono)]">
                  <button
                    onClick={sendCode}
                    disabled={busy || cooldown > 0}
                    className="text-[#9ca3af] hover:text-[#f26a1b] disabled:opacity-40 transition-colors"
                  >
                    {cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend code'}
                  </button>
                  <button
                    onClick={() => { setStep('email'); setCode(''); setError('') }}
                    className="text-[#9ca3af] hover:text-white transition-colors"
                  >
                    ← Change email
                  </button>
                </div>
              </div>
            </>
          )}

        </div>

        <p className="text-center text-[0.65rem] text-[#444] font-mono mt-6">
          PMI Top Florida Properties · Staff Portal
        </p>
      </div>
    </div>
  )
}
