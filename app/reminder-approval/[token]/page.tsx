'use client'

// PMI + Jonathan's approve/decline page for the 3-day missing-docs reminder's
// FIRST cycle on an application (lib/application-reminder.ts). Approving sends
// the reminder to every stakeholder right now and clears the gate for every
// later cycle — the cron auto-sends after that, with no further approval
// needed. No login — the token in the URL is the credential.

import { use, useCallback, useEffect, useState } from 'react'

interface State {
  status: 'pending' | 'approved' | 'declined'
  missingSummary: string[]
  recipients: { name: string | null; email: string; role: string }[]
  sentTo: string[]
  decidedAt: string | null
  associationCode: string | null
  unitLabel: string | null
}

const ROLE_LABEL: Record<string, string> = { applicant: 'Applicant', owner: 'Owner', listing_agent: 'Listing agent', applicant_agent: 'Tenant/Buyer agent' }

export default function ReminderApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [s, setS] = useState<State | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)

  const load = useCallback(() => fetch(`/api/reminder-approval/${token}`)
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
    .then(setS).catch(e => setErr(String(e.message ?? e))), [token])
  useEffect(() => { void load() }, [load])

  async function decide(action: 'approve' | 'decline') {
    setBusy(action); setErr(null)
    try {
      const r = await fetch(`/api/reminder-approval/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      await load()
    } catch (e) { setErr(String((e as Error).message ?? e)) } finally { setBusy(null) }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#eceef2', fontFamily: 'system-ui', padding: '28px 16px' }
  const card: React.CSSProperties = { maxWidth: 620, margin: '0 auto', background: '#fff', border: '1px solid #e7e2d9', borderRadius: 14, padding: '30px 32px' }
  const eyebrow: React.CSSProperties = { font: '700 11px system-ui', letterSpacing: '.14em', textTransform: 'uppercase', color: '#c0571a', marginBottom: 10 }

  if (err && !s) return <div style={wrap}><div style={card}><div style={eyebrow}>PMI Top Florida Properties · MAIA</div><h1 style={{ font: '800 22px Georgia,serif', color: '#1c2333' }}>Link unavailable</h1><p style={{ color: '#6b7280' }}>{err}</p></div></div>
  if (!s) return <div style={wrap}><div style={card}><p style={{ color: '#9ca3af' }}>Loading…</p></div></div>

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={eyebrow}>PMI Top Florida Properties · MAIA</div>
        <h1 style={{ font: '800 24px/1.2 Georgia,serif', color: '#1c2333', margin: '0 0 6px' }}>
          {s.associationCode}{s.unitLabel ? ` · Unit ${s.unitLabel}` : ''} — missing-documents reminder
        </h1>

        {s.status === 'pending' && (
          <p style={{ font: '13.5px system-ui', color: '#6b7280', margin: '0 0 16px' }}>
            Approve to email everyone on this application right now. Once approved, MAIA sends this same reminder automatically every 3 days until nothing&apos;s missing — no further approval needed.
          </p>
        )}
        {s.status === 'approved' && (
          <p style={{ font: '13.5px system-ui', color: '#166534', margin: '0 0 16px' }}>
            ✓ Approved{s.decidedAt ? ` on ${new Date(s.decidedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET` : ''}. {s.sentTo.length ? `Sent to ${s.sentTo.join(', ')}.` : ''} Future cycles will send automatically.
          </p>
        )}
        {s.status === 'declined' && (
          <p style={{ font: '13.5px system-ui', color: '#92400e', margin: '0 0 16px' }}>
            Declined{s.decidedAt ? ` on ${new Date(s.decidedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET` : ''}. Nothing was sent. MAIA will ask again in a few days if it&apos;s still outstanding.
          </p>
        )}

        <div style={{ font: '700 12px system-ui', color: '#374151', margin: '0 0 6px' }}>Still missing:</div>
        <ul style={{ margin: '0 0 16px', paddingLeft: 20, font: '13.5px system-ui', color: '#374151', lineHeight: 1.6 }}>
          {s.missingSummary.map((m, i) => <li key={i}>{m}</li>)}
        </ul>

        <div style={{ font: '700 12px system-ui', color: '#374151', margin: '0 0 6px' }}>Will be sent to:</div>
        <ul style={{ margin: '0 0 22px', paddingLeft: 20, font: '13.5px system-ui', color: '#374151', lineHeight: 1.6 }}>
          {s.recipients.map((r, i) => <li key={i}>{r.name || r.email} <span style={{ color: '#9ca3af' }}>· {ROLE_LABEL[r.role] ?? r.role} · {r.email}</span></li>)}
        </ul>

        {s.status === 'pending' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => decide('approve')} disabled={!!busy}
              style={{ cursor: busy ? 'default' : 'pointer', font: '700 14px system-ui', color: '#fff', background: busy === 'approve' ? '#9ca3af' : '#166534', border: 'none', borderRadius: 9, padding: '11px 20px' }}>
              {busy === 'approve' ? 'Sending…' : '✓ Approve & send now'}
            </button>
            <button onClick={() => decide('decline')} disabled={!!busy}
              style={{ cursor: busy ? 'default' : 'pointer', font: '700 14px system-ui', color: '#92400e', background: '#fff', border: '1px solid #fde68a', borderRadius: 9, padding: '11px 20px' }}>
              {busy === 'decline' ? '…' : 'Not yet'}
            </button>
          </div>
        )}
        {err && <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 14 }}>⚠ {err}</p>}
        <p style={{ font: '12px system-ui', color: '#9ca3af', marginTop: 20, borderTop: '1px solid #e7e2d9', paddingTop: 14 }}>You can close this tab once you&apos;ve decided.</p>
      </div>
    </div>
  )
}
