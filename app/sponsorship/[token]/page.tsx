'use client'

// The approved tenant confirms somebody joining their lease.
//
// The occupant's email is REQUIRED and must differ from the tenant's — and the
// page says WHY, because "use a different email" without a reason is the kind
// of rule people work around. MAIA sends the occupant their own forms to sign,
// and a signature has to be verified against the signer's own mailbox.

import { use, useCallback, useEffect, useState } from 'react'

interface Info {
  associationName: string; unitLabel: string | null
  tenantName: string | null; tenantEmail: string | null
  occupantName: string; acknowledgment: string
  answered: boolean; decision: string | null
  occupantEmail: string | null; occupantPhone: string | null
}

const wrap: React.CSSProperties = { maxWidth: 620, margin: '0 auto', padding: '30px 18px 70px', fontFamily: 'system-ui, sans-serif', color: '#16202f' }
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 18 }
const label: React.CSSProperties = { display: 'block', font: '600 12.5px system-ui', color: '#4a5265', marginBottom: 4 }
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', font: '15px system-ui', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8 }

export default function SponsorshipPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [ack, setAck] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/sponsorship/${token}`).then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else setInfo(d) })
      .catch(() => setErr('Network error — please reload.'))
  }, [token])
  useEffect(load, [load])

  async function answer(decision: 'requested' | 'declined') {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/sponsorship/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, occupantEmail: email, occupantPhone: phone, acknowledged: ack, note }),
      })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not save')
      setDone(decision)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (err && !info) return <div style={wrap}><h2 style={{ color: '#b42318' }}>⚠ {err}</h2></div>
  if (!info) return <div style={wrap}><p style={{ color: '#7c8496' }}>Loading…</p></div>

  if (done || info.answered) {
    const d = done ?? info.decision
    return (
      <div style={wrap}>
        <h1 style={{ font: '600 25px/1.25 Georgia, serif', color: '#16202f' }}>
          {d === 'declined' ? 'Thank you — noted' : '✅ Thank you'}
        </h1>
        <p style={{ color: '#4a5265', fontSize: 15 }}>
          {d === 'declined'
            ? 'We have recorded that you are not asking for this person to be added. The office will follow up.'
            : `We have recorded your request to add ${info.occupantName}, and their own contact details. They will receive their forms directly.`}
        </p>
      </div>
    )
  }

  const sameAsTenant = email.trim().toLowerCase() === String(info.tenantEmail ?? '').trim().toLowerCase() && !!email.trim()
  const canSubmit = !!email.trim() && !!phone.trim() && ack && !sameAsTenant

  return (
    <div style={wrap}>
      <p style={{ font: '600 11.5px system-ui', letterSpacing: '.14em', textTransform: 'uppercase', color: '#f26a1b', margin: 0 }}>{info.associationName}</p>
      <h1 style={{ font: '600 26px/1.2 Georgia, serif', margin: '8px 0 0' }}>
        Adding an occupant{info.unitLabel ? ` to Unit ${info.unitLabel}` : ''}
      </h1>
      <p style={{ color: '#4a5265', fontSize: 15, marginTop: 8 }}>
        <strong>{info.occupantName}</strong> has been put forward as an additional occupant of your unit.
        Before the Board reviews it, please confirm you are asking for them to be added.
      </p>

      <div style={{ ...card, marginTop: 18 }}>
        <div style={{ font: '600 15px system-ui', marginBottom: 12 }}>Their own contact details</div>

        <div style={{ background: '#fff8ec', border: '1px solid #fde68a', borderRadius: 9, padding: '11px 13px', marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: '#92400e', lineHeight: 1.5 }}>
            These must be <strong>{info.occupantName}&rsquo;s own</strong>, not yours. MAIA sends them their own
            forms to sign, and a signature has to be verified against the signer&rsquo;s own mailbox — so an
            address shared with you would record their signature against your email.
          </p>
        </div>

        <label style={label} htmlFor="oe">Their email address</label>
        <input id="oe" value={email} onChange={e => setEmail(e.target.value)} placeholder="their.own@example.com" type="email"
          style={{ ...input, borderColor: sameAsTenant ? '#b42318' : '#d1d5db' }} />
        {sameAsTenant && (
          <p style={{ font: '13px system-ui', color: '#b42318', margin: '6px 0 0' }}>
            That is your own address. {info.occupantName} needs their own.
          </p>
        )}
        {info.tenantEmail && !sameAsTenant && (
          <p style={{ font: '12px system-ui', color: '#9ca3af', margin: '5px 0 0' }}>Yours is {info.tenantEmail} — theirs must be different.</p>
        )}

        <label style={{ ...label, marginTop: 14 }} htmlFor="op">Their phone number</label>
        <input id="op" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(954) 555-0100" inputMode="tel" style={input} />

        <label style={{ ...label, marginTop: 14 }} htmlFor="nt">Anything we should know (optional)</label>
        <textarea id="nt" value={note} onChange={e => setNote(e.target.value)} style={{ ...input, minHeight: 60, resize: 'vertical' }} />
      </div>

      <label style={{ ...card, marginTop: 14, display: 'flex', gap: 11, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 3 }} />
        <span style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.55 }}>{info.acknowledgment}</span>
      </label>

      {err && <p style={{ color: '#b42318', fontSize: 14, background: '#fdf2f0', border: '1px solid #f3c9c3', borderRadius: 8, padding: '10px 12px', marginTop: 14 }}>⚠ {err}</p>}

      <button onClick={() => answer('requested')} disabled={busy || !canSubmit}
        style={{ width: '100%', marginTop: 16, padding: 14, font: '700 16px system-ui', color: '#fff', border: 'none', borderRadius: 10,
          background: busy || !canSubmit ? '#9ca3af' : '#f26a1b', cursor: busy || !canSubmit ? 'default' : 'pointer' }}>
        {busy ? 'Sending…' : 'Yes — please add this occupant'}
      </button>
      <button onClick={() => answer('declined')} disabled={busy}
        style={{ width: '100%', marginTop: 9, padding: 12, font: '600 14px system-ui', color: '#b42318', background: '#fff', border: '1px solid #f3c9c3', borderRadius: 10, cursor: 'pointer' }}>
        No — I am not asking for this
      </button>

      <p style={{ color: '#9aa0ab', fontSize: 12, marginTop: 20, textAlign: 'center' }}>PMI Top Florida Properties</p>
    </div>
  )
}
