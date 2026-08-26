'use client'

// The Military Service Member Disclosure, as the applicant answers it. One
// question, no branching — rendered by the generic e-sign page while the
// document still needs an answer. There is no separate summary component:
// once saved, the answer becomes a row in the document's own details[] (see
// /api/esign/[token]/fill), which the generic review/sign step already
// renders with no kind-specific code.

import { useState } from 'react'

const QUESTION = 'Are you a member of the United States Armed Forces on active duty, and/or a member of the Florida National Guard or United States Reserve Forces?'

function optionStyle(picked: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '12px', fontSize: 15, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${picked ? '#f26a1b' : '#d1d5db'}`, background: picked ? '#fff7ed' : '#fff', color: picked ? '#c2410c' : '#374151',
  }
}

export function MilitaryDisclosureFill({ token, onFilled }: { token: string; onFilled: () => void }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!answer) { setErr('Please answer the question above.'); return }
    setErr(null); setBusy(true)
    try {
      const r = await fetch(`/api/esign/${token}/fill`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isServiceMember: answer }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not save')
      onFilled()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, background: '#fff' }}>
        <p style={{ font: '15px system-ui', color: '#1f2a44', margin: 0, lineHeight: 1.5 }}>{QUESTION}</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={() => setAnswer('yes')} style={optionStyle(answer === 'yes')}>Yes</button>
          <button onClick={() => setAnswer('no')} style={optionStyle(answer === 'no')}>No</button>
        </div>
        <p style={{ font: '12px system-ui', color: '#9ca3af', margin: '10px 0 0' }}>Leaving this unanswered makes the application incomplete.</p>
      </div>
      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={save} disabled={busy || !answer}
        style={{ width: '100%', marginTop: 14, padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: (busy || !answer) ? '#9ca3af' : '#f26a1b', border: 'none', borderRadius: 8, cursor: (busy || !answer) ? 'default' : 'pointer' }}>
        {busy ? 'Saving…' : 'Continue to review & sign'}
      </button>
    </div>
  )
}
