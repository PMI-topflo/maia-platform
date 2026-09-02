'use client'

// Public token-gated page (no login — the link is the auth, matching
// /lease-renewal/[token]'s precedent): the applicant pays the flat $150
// re-screening charge after their Checkr screening expired 45+ days without
// their application being completed (docs/ROADMAP.md's "Re-screening
// charge" section). Linked from the expiry notice email
// (app/api/cron/screening-expiry-warnings/route.ts's expiredHtml()).

import { use, useCallback, useEffect, useState } from 'react'

interface Data { status: 'pending' | 'paid'; paidAt: string | null; unit: string; association: string }

// The exact required legal framing (user-provided, Florida condo
// §718.112(2)(k) context) -- copy this string verbatim everywhere the
// re-screening charge is mentioned. Never paraphrase it.
const NOT_AN_APPLICATION_FEE_NOTICE =
  'This is not an association application fee. It reimburses the actual cost of ' +
  'obtaining a new third-party background/credit report and processing it in the ' +
  'system, required because your prior screening expired 45+ days ago without your ' +
  'application being completed.'

export default function RescreenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/rescreen/${token}`).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'This link is invalid or has expired.'); return j })
      .then(setD).catch(e => setErr(String(e.message ?? e)))
  }, [token])
  useEffect(load, [load])

  async function pay() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/rescreen/${token}`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not start checkout.')
      window.location.href = j.url
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#eceef2', fontFamily: 'system-ui, sans-serif', padding: '28px 16px' }
  const card: React.CSSProperties = { maxWidth: 560, margin: '0 auto', background: '#fff', border: '1px solid #e7e2d9', borderRadius: 14, padding: '30px 32px' }

  if (err) return <div style={wrap}><div style={card}><h2 style={{ color: '#b91c1c' }}>⚠ {err}</h2></div></div>
  if (!d) return <div style={wrap}><div style={card}><p>Loading…</p></div></div>

  const paid = d.status === 'paid'

  return (
    <div style={wrap}>
      <div style={card}>
        <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', margin: 0 }}>{d.association}</p>
        <h1 style={{ fontSize: 22, color: '#1f2a44', margin: '4px 0 14px' }}>
          {paid ? '✅ Payment received' : 'Background screening expired'}
        </h1>

        {paid ? (
          <>
            <p style={{ color: '#374151', fontSize: 14.5, lineHeight: 1.6 }}>
              Thank you — your $150 payment was received{d.paidAt ? ` on ${new Date(d.paidAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}. Your new background screening is now being processed for <strong>Unit {d.unit}</strong>.
            </p>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 14 }}>You can close this page — we&apos;ll be in touch once it&apos;s complete, and you can continue submitting any remaining documents in the meantime.</p>
          </>
        ) : (
          <>
            <p style={{ color: '#374151', fontSize: 14.5, lineHeight: 1.6 }}>
              Your background screening for <strong>Unit {d.unit}</strong> has expired — more than 45 days have passed since it completed, and the application still isn&apos;t complete. To continue, a fresh screening is required.
            </p>
            <div style={{ margin: '16px 0', padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9 }}>
              <p style={{ fontSize: 12.5, color: '#92400e', margin: 0, lineHeight: 1.5 }}>⚠ {NOT_AN_APPLICATION_FEE_NOTICE}</p>
            </div>
            {err && <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{err}</p>}
            <button onClick={pay} disabled={busy}
              style={{ width: '100%', padding: 14, fontSize: 16, fontWeight: 700, color: '#fff', background: busy ? '#9ca3af' : '#c0571a', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Redirecting to secure checkout…' : 'Pay $150 & continue my application'}
            </button>
            <p style={{ color: '#9ca3af', fontSize: 11.5, marginTop: 12, textAlign: 'center' }}>Secured by Stripe · PCI DSS compliant</p>
          </>
        )}
        <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 20, textAlign: 'center' }}>PMI Top Florida Properties · ✉ PMI@topfloridaproperties.com · ☎ (305) 900-5077</p>
      </div>
    </div>
  )
}
