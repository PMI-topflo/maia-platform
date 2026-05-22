'use client'

import { useState } from 'react'
import Link from 'next/link'

import { SMS_OPTIN_TEXT } from '@/lib/sms-optin'

export default function OptInForm() {
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [phone,     setPhone]     = useState('')
  const [email,     setEmail]     = useState('')
  const [smsConsent, setSmsConsent] = useState(false)   // unticked by default
  const [agreeTerms, setAgreeTerms] = useState(false)   // unticked by default
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Only the basic contact fields gate the button — NEITHER consent box
  // is required to submit (A2P 10DLC rule: consent must be optional).
  const canSubmit = firstName.trim().length > 0 && phone.replace(/\D/g, '').length >= 10

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/sms-opt-in', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          first_name: firstName.trim(),
          last_name:  lastName.trim(),
          phone:      phone.trim(),
          email:      email.trim(),
          sms_consent: smsConsent,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Something went wrong')
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-7 text-center">
        <div className="text-2xl">✓</div>
        <p className="mt-1 text-sm font-semibold text-green-800">Thank you — your details were received.</p>
        <p className="mt-1 text-xs text-green-700">
          {smsConsent
            ? 'You have opted in to SMS updates from PMI Top Florida Properties. Reply STOP at any time to unsubscribe.'
            : 'You can opt in to SMS updates any time by returning to this page.'}
        </p>
      </div>
    )
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#f26a1b] focus:outline-none'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input className={inputCls} placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" />
        <input className={inputCls} placeholder="Last name"  value={lastName}  onChange={e => setLastName(e.target.value)}  autoComplete="family-name" />
      </div>
      <input className={inputCls} type="tel"   placeholder="Phone number" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
      <input className={inputCls} type="email" placeholder="Email"        value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />

      {/* SMS consent — UNTICKED by default, and NOT required to submit. */}
      <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
        <input
          type="checkbox"
          checked={smsConsent}
          onChange={e => setSmsConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#f26a1b]"
        />
        <span className="text-xs leading-relaxed text-gray-600">{SMS_OPTIN_TEXT}</span>
      </label>

      {/* Scannable SMS disclosures — mirrors the consent wording so an A2P
          10DLC reviewer can verify frequency / rates / HELP-STOP at a glance. */}
      <p className="rounded-md bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
        <strong className="font-semibold text-gray-700">Message frequency varies.</strong>{' '}
        Message &amp; data rates may apply. Reply{' '}
        <strong className="font-semibold text-gray-700">HELP</strong> for help,{' '}
        <strong className="font-semibold text-gray-700">STOP</strong> to cancel.
      </p>

      {/* Terms / Privacy — also optional. */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={agreeTerms}
          onChange={e => setAgreeTerms(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#f26a1b]"
        />
        <span className="text-xs leading-relaxed text-gray-600">
          I have read and agree to the{' '}
          <Link href="/terms" target="_blank" className="text-[#f26a1b] underline">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy-policy" target="_blank" className="text-[#f26a1b] underline">Privacy Policy</Link>.
        </span>
      </label>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="w-full rounded-lg bg-[#f26a1b] py-3 text-sm font-semibold text-white hover:bg-[#d85a14] disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Continue'}
      </button>
      <p className="text-center text-[11px] text-gray-400">
        Checking the SMS box is optional — you can submit this form either way.
      </p>
    </form>
  )
}
