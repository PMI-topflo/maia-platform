// =====================================================================
// /sms-opt-in
//
// Public SMS opt-in webform — the A2P 10DLC "call to action" / opt-in
// workflow page submitted to Twilio. Compliant by design:
//   • the SMS-consent checkbox is UNCHECKED by default
//   • it is NOT required to submit the form
//   • the exact opt-in wording is shown and stored on consent
//   • Privacy Policy + Terms of Service are linked
//   • the business name is shown clearly
// =====================================================================

import Link from 'next/link'

import OptInForm from './OptInForm'

export const metadata = {
  title: 'Text Message Sign-Up — Dawnus LLC d/b/a PMI Top Florida Properties',
  description: 'Opt in to receive account, maintenance, and community SMS updates from Dawnus LLC d/b/a PMI Top Florida Properties.',
}

export default function SmsOptInPage() {
  return (
    <div className="min-h-screen bg-gray-100 px-6 py-10">
      <div className="mx-auto max-w-md overflow-hidden rounded-xl bg-white shadow-sm">

        {/* Brand header — identifies BOTH the legal entity (Dawnus LLC)
            and the trade name (PMI Top Florida Properties) so an A2P
            10DLC reviewer can match the brand registration to what
            customers actually see on the opt-in surface. */}
        <div className="border-b border-gray-100 px-7 py-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pmi-logo.png" alt="PMI Top Florida Properties" className="mx-auto h-12 w-auto" />
          <h1 className="mt-3 text-lg font-bold text-[#1f2a44]">PMI Top Florida Properties</h1>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">
            A division of Dawnus LLC
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Sign up to receive account, maintenance, and community text updates
            from your property management team.
          </p>
        </div>

        {/* The form */}
        <div className="px-7 py-6">
          <OptInForm />
        </div>

        {/* Compliance footer — must spell out the registered legal
            entity AND a physical address. A2P 10DLC reviewers visit
            this exact page; missing either is grounds for rejection. */}
        <div className="border-t border-gray-100 bg-gray-50 px-7 py-4 text-center text-[11px] leading-relaxed text-gray-500">
          <strong className="font-semibold text-gray-700">Dawnus LLC</strong> d/b/a PMI Top Florida Properties<br />
          1031 Ives Dairy Road, Suite 228 · Miami, FL 33179<br />
          305.900.5077 · maia@pmitop.com<br />
          Message &amp; data rates may apply · Reply STOP to unsubscribe, HELP for help.<br />
          <Link href="/sms-consent" className="text-[#f26a1b] underline">SMS Terms</Link>
          {' · '}
          <Link href="/privacy-policy" className="text-[#f26a1b] underline">Privacy Policy</Link>
          {' · '}
          <Link href="/terms" className="text-[#f26a1b] underline">Terms of Service</Link>
        </div>

      </div>
    </div>
  )
}
