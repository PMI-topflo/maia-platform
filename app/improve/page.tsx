// =====================================================================
// app/improve/page.tsx
//
// "Suggest a MAIA improvement" — the landing page for the per-person link
// in the daily-news email. Standalone branded form (no auth); ?from=Name
// pre-fills the submitter. POSTs to /api/improve.
// =====================================================================
'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const NAVY   = '#1f2a44'
const ORANGE = '#f26a1b'

function ImproveForm() {
  const params = useSearchParams()
  const [name, setName]   = useState(params.get('from') ?? '')
  const [idea, setIdea]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [done, setDone]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/improve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: 'Helvetica, Arial, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ background: NAVY, color: '#fff', padding: '22px 26px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.12em', color: '#aab3c5', textTransform: 'uppercase' }}>PMI Top Florida Properties</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>💡 Improve MAIA</div>
          <div style={{ fontSize: 13, color: '#d7dbe4', marginTop: 2 }}>Got an idea to make MAIA better? Tell us — it goes straight to the dev backlog.</div>
        </div>

        {done ? (
          <div style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>🎉</div>
            <h2 style={{ color: NAVY, fontSize: 18, margin: '10px 0 4px' }}>Thank you{name ? `, ${name}` : ''}!</h2>
            <p style={{ color: '#3a3f4a', fontSize: 14 }}>Your idea is in the backlog. Fabio will review it.</p>
            <button onClick={() => { setDone(false); setIdea('') }}
              style={{ marginTop: 12, background: 'transparent', color: ORANGE, border: `1px solid ${ORANGE}`, borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>
              Submit another
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ padding: 26 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Your name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="(optional)"
              style={{ width: '100%', padding: 9, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }} />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Your idea</label>
            <textarea value={idea} onChange={e => setIdea(e.target.value)} required rows={6}
              placeholder="What should MAIA do, or do better? Be as specific as you like."
              style={{ width: '100%', padding: 9, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />

            {error && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{error}</div>}

            <button type="submit" disabled={busy || idea.trim().length < 3}
              style={{ marginTop: 16, width: '100%', background: ORANGE, color: '#fff', border: 'none', borderRadius: 6, padding: '12px', fontWeight: 700, fontSize: 15, cursor: busy ? 'default' : 'pointer', opacity: busy || idea.trim().length < 3 ? 0.6 : 1 }}>
              {busy ? 'Sending…' : 'Send my idea'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ImprovePage() {
  return (
    <Suspense fallback={null}>
      <ImproveForm />
    </Suspense>
  )
}
