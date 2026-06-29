'use client'

// =====================================================================
// /apply/owner-validate/[token]  — Owner confirms their unit's occupancy
// after an agent listed it. Pre-filled from system data; owner confirms.
// =====================================================================

import { use, useEffect, useState } from 'react'

export default function OwnerValidatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [info, setInfo] = useState<{ unit: string | null; listing_type: string | null; already_validated: boolean; prefill: { vacant: boolean | null; prior_tenant: string | null } } | null>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [vacant, setVacant] = useState<boolean | null>(null)
  const [moved, setMoved]   = useState<boolean | null>(null)

  useEffect(() => {
    fetch(`/api/apply/owner-validate/${token}`).then(r => r.json()).then(d => {
      if (d.ok) { setInfo(d); setVacant(d.prefill?.vacant ?? null); setDone(d.already_validated) }
      else setErr(d.error ?? 'This link is invalid.')
    }).catch(() => setErr('Could not load.'))
  }, [token])

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/apply/owner-validate/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitVacant: vacant, priorTenantMovedOut: vacant ? moved : null }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Something went wrong.'); return }
      setDone(true)
    } catch { setErr('Network error.') } finally { setBusy(false) }
  }

  const wrap: React.CSSProperties = { maxWidth: 520, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }
  const pill = (active: boolean): React.CSSProperties => ({ flex: 1, padding: '10px', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', border: `1px solid ${active ? '#f26a1b' : '#d1d5db'}`, background: active ? '#fff7ed' : '#fff', color: active ? '#c2410c' : '#374151' })

  if (err && !info) return <div style={wrap}><h2>⚠ {err}</h2></div>
  if (!info) return <div style={wrap}><p>Loading…</p></div>
  if (done) return (
    <div style={wrap}>
      <h1 style={{ color: '#f26a1b' }}>✅ Thank you</h1>
      <p>We&apos;ve recorded your confirmation for <strong>Unit {info.unit}</strong>. You also have access to the association&apos;s budget &amp; financials — check your email.</p>
    </div>
  )

  const what = info.listing_type === 'sale' ? 'for sale' : info.listing_type === 'rent' ? 'for rent' : 'on the market'
  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 22, color: '#f26a1b', marginBottom: 2 }}>Confirm your unit</h1>
      <p style={{ color: '#374151', fontSize: 14 }}>An agent listed <strong>Unit {info.unit}</strong> {what}. Please confirm a couple of details so our records stay accurate.</p>

      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 18 }}>Is the unit currently vacant?</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button style={pill(vacant === true)}  onClick={() => setVacant(true)}>Vacant</button>
        <button style={pill(vacant === false)} onClick={() => setVacant(false)}>Occupied</button>
      </div>

      {vacant === true && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 18 }}>
            Did the previous tenant move out?{info.prefill?.prior_tenant ? ` (we have ${info.prefill.prior_tenant} on file)` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button style={pill(moved === true)}  onClick={() => setMoved(true)}>Yes, moved out</button>
            <button style={pill(moved === false)} onClick={() => setMoved(false)}>No / still there</button>
          </div>
        </>
      )}

      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={submit} disabled={busy || vacant === null}
        style={{ width: '100%', marginTop: 22, padding: 13, fontSize: 16, fontWeight: 700, color: '#fff', background: (busy || vacant === null) ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: (busy || vacant === null) ? 'default' : 'pointer' }}>
        {busy ? 'Saving…' : 'Confirm'}
      </button>
    </div>
  )
}
