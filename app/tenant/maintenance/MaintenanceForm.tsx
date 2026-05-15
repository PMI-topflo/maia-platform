'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'

interface Props {
  tenantName:  string
  unitNumber:  string
  assocName:   string
}

const PRIORITY_OPTIONS = [
  { value: 'normal', label: 'Normal — within a few days'  },
  { value: 'high',   label: 'High — needs attention this week' },
  { value: 'urgent', label: 'Urgent — safety / water / no power' },
] as const

export default function MaintenanceForm({ tenantName, unitNumber, assocName }: Props) {
  const [subject,  setSubject]  = useState('')
  const [body,     setBody]     = useState('')
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>('normal')
  const [submitting, setSubmitting] = useState(false)
  const [result,    setResult]    = useState<{ ticket_number: string; ticket_id: number } | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) {
      setError('Please provide a subject and a description.')
      return
    }
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/tenant/maintenance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subject: subject.trim(), body: body.trim(), priority }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Submit failed')
      setResult({ ticket_number: data.ticket_number, ticket_id: data.ticket_id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '1.5rem', maxWidth: 640 }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#15803d', marginBottom: '0.4rem' }}>✓ Request submitted</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--navy)', marginBottom: '0.9rem' }}>
          Your request <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--orange)' }}>{result.ticket_number}</span> has been logged. The management team will follow up by email or phone. You don&apos;t need to do anything else.
        </div>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <Link href="/tenant" style={{ background: 'var(--orange)', color: '#fff', padding: '0.55rem 1rem', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', textDecoration: 'none' }}>Back to portal</Link>
          <button
            type="button"
            onClick={() => { setResult(null); setSubject(''); setBody(''); setPriority('normal') }}
            style={{ background: 'transparent', color: 'var(--muted)', padding: '0.55rem 1rem', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid var(--border)', cursor: 'pointer' }}
          >
            Submit another
          </button>
        </div>
      </div>
    )
  }

  const labelCls: React.CSSProperties = { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.3rem' }
  const inputCls: React.CSSProperties = { width: '100%', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.9rem', background: '#fff', color: 'var(--navy)' }

  return (
    <form onSubmit={onSubmit} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '1.5rem', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--muted)', borderLeft: '3px solid var(--orange)', paddingLeft: '0.75rem' }}>
        Reporting as <strong style={{ color: 'var(--navy)' }}>{tenantName}</strong> · Unit {unitNumber || '—'} · {assocName}
      </div>

      <label>
        <span style={labelCls}>Subject *</span>
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="e.g. Leaking ceiling above kitchen sink"
          style={inputCls}
          required
        />
      </label>

      <label>
        <span style={labelCls}>What&apos;s going on? *</span>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={6}
          placeholder="Where in the unit, when did it start, any photos available? More detail helps us dispatch the right person."
          style={{ ...inputCls, resize: 'vertical', fontFamily: 'inherit' }}
          required
        />
      </label>

      <label>
        <span style={labelCls}>Urgency</span>
        <select
          value={priority}
          onChange={e => setPriority(e.target.value as 'normal' | 'high' | 'urgent')}
          style={{ ...inputCls, cursor: 'pointer' }}
        >
          {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      {error && <div style={{ color: '#b91c1c', fontSize: '0.85rem', background: '#fef2f2', padding: '0.6rem 0.8rem', borderRadius: 4, border: '1px solid #fecaca' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', paddingTop: '0.4rem', borderTop: '1px solid var(--border)' }}>
        <button
          type="submit"
          disabled={submitting || !subject.trim() || !body.trim()}
          style={{ background: 'var(--orange)', color: '#fff', padding: '0.6rem 1.2rem', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
        <Link href="/tenant" style={{ fontSize: '0.75rem', color: 'var(--muted)', textDecoration: 'none' }}>Cancel</Link>
      </div>
    </form>
  )
}
