'use client'

// =====================================================================
// ContactTickets.tsx
//
// Replaces the portal's contact cards (which published untracked dept
// emails + phones) with "open a ticket" buttons. Each department opens a
// short form that creates a tracked MAIA ticket routed to that inbox
// (POST /api/contact/ticket) — so resident ↔ team communication stays on
// platform. Department names are translated (passed from portal i18n);
// the form body is English for now.
// =====================================================================

import { useEffect, useState } from 'react'

type DeptKey = 'ar' | 'maintenance' | 'compliance' | 'billing'
const ICON: Record<DeptKey, string> = { ar: '💰', maintenance: '🔧', compliance: '⚖️', billing: '🧾' }
const ORDER: DeptKey[] = ['ar', 'maintenance', 'compliance', 'billing']

export default function ContactTickets({ labels, openLabel, assocCode }: { labels: Record<DeptKey, string>; openLabel: string; assocCode?: string }) {
  const [dept, setDept] = useState<DeptKey | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  // Pre-fill the resident's name from their session (best-effort). A public,
  // not-signed-in visitor gets none of this and must fill name/email themselves.
  useEffect(() => {
    fetch('/api/auth/check-session').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.valid && d.session) {
        setSignedIn(true)
        setName(d.session.contactName || d.session.displayName || '')
        if (typeof d.session.userId === 'string' && d.session.userId.includes('@')) setEmail(d.session.userId)
      }
    }).catch(() => null)
  }, [])

  function close() { setDept(null); setSubject(''); setMessage(''); setErr(null); setDone(null) }

  async function submit() {
    if (!subject.trim() || !message.trim()) { setErr('Please add a subject and a message.'); return }
    // Not signed in → there's no session to identify the sender, so name +
    // a valid email are required (the API rejects an anonymous submission
    // without them anyway; catch it client-side for a clearer message).
    if (!signedIn) {
      if (!name.trim() || !email.trim()) { setErr('Please add your name and email so we can reply.'); return }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Please enter a valid email.'); return }
    }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/contact/ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dept, subject, message, contactName: name, contactEmail: email, contactPhone: phone, assocCode }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'Could not send.')
      setDone(d.ticket_number ? `Sent — your reference is ${d.ticket_number}. We'll reply by ticket.` : "Sent! We'll be in touch.")
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="contact-grid">
        {ORDER.map(k => (
          <button key={k} type="button" onClick={() => setDept(k)} className="contact-card" style={{ cursor: 'pointer', textAlign: 'center', font: 'inherit' }}>
            <div className="contact-icon">{ICON[k]}</div>
            <div className="contact-label">{labels[k]}</div>
            <div className="contact-phone" style={{ color: 'var(--gold)' }}>✉ {openLabel}</div>
          </button>
        ))}
      </div>

      {dept && (
        <div role="dialog" aria-modal="true" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(13,13,13,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: 460, width: '100%', padding: '1.5rem', boxShadow: '0 20px 60px rgba(13,13,13,.35)', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: '#0f172a' }}>{ICON[dept]} {labels[dept]}</div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>We&rsquo;ll reply by ticket — your message stays tracked.</div>
              </div>
              <button onClick={close} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#94a3b8', cursor: 'pointer' }}>&times;</button>
            </div>

            {done ? (
              <div style={{ background: '#ecfdf5', color: '#065f46', borderRadius: 8, padding: '1rem', fontSize: '0.88rem' }}>✓ {done}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={inp} />
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" style={inp} />
                </div>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" style={{ ...inp, flex: '1 1 100%' }} />
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={{ ...inp, flex: '1 1 100%' }} />
                <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="How can we help?" rows={4} style={{ ...inp, flex: '1 1 100%', resize: 'vertical' }} />
                {err && <div style={{ color: '#dc2626', fontSize: '0.8rem' }}>⚠ {err}</div>}
                <button onClick={submit} disabled={busy} style={{ background: '#f26a1b', color: '#fff', border: 'none', borderRadius: 8, padding: '0.75rem', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const inp: React.CSSProperties = { flex: '1 1 160px', minWidth: 0, padding: '0.6rem 0.7rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.85rem', color: '#0f172a' }
