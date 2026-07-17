'use client'

// Board invoice-approval responder — vendor + amount, Approve (e-sign;
// saved signature reused or re-drawn) or Request a revision (comment).
// A "voter" badge is informational only: their approval is recorded but
// doesn't close the approval on its own (see required/decider counting
// in app/api/board/invoice-review/route.ts).

import { useEffect, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'

interface Data {
  decided: boolean; member: string | null; member_type: 'decider' | 'voter' | null
  vendor_name: string | null; amount: number | null; association_code: string | null
  status: string; required: number
  saved_signature: string | null
}
const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function InvoiceApprovalClient({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'idle' | 'approve' | 'revision'>('idle')
  const [redraw, setRedraw] = useState(false)
  const [sig, setSig] = useState<string | null>(null)
  const [comments, setComments] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/board/invoice-review?token=${encodeURIComponent(token)}`).then(r => r.json())
      .then((d: Data & { error?: string }) => {
        if (!live) return
        if (d.error) { setError(d.error); return }
        setData(d); setSig(d.saved_signature ?? null)
      })
      .catch(() => setError('Could not load this approval.')).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [token])

  async function submit(decision: 'approve' | 'revision') {
    if (decision === 'approve' && !sig) { setError('Please add your signature.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/board/invoice-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decision, signature: decision === 'approve' ? sig : undefined, comments }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setDone(decision === 'approve' ? (d.status === 'approved' ? 'Approved — the board threshold is met. Thank you!' : 'Your approval is recorded. Thank you!') : 'Revision requested — our accounting team has been notified. Thank you!')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }
  if (loading) return <div style={card}>Loading…</div>
  if (error && !data) return <div style={{ ...card, color: '#991b1b' }}>{error}</div>
  if (!data) return null
  if (done) return <div style={{ ...card, background: '#ecfdf5', color: '#065f46' }}>✓ {done}</div>
  if (data.decided) return <div style={{ ...card, color: '#374151' }}>You&apos;ve already submitted a decision on this invoice. Thank you.</div>

  return (
    <div style={card}>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>Invoice approval</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
        {data.association_code ?? ''} · needs {data.required} decider approval{data.required === 1 ? '' : 's'}
        {data.member_type === 'voter' && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>YOUR VOTE IS ADVISORY</span>}
      </div>

      <table style={{ borderCollapse: 'collapse', marginBottom: 16, fontSize: 14 }}>
        <tbody>
          <tr><td style={{ padding: '6px 10px', background: '#f9fafb', border: '1px solid #eee', fontWeight: 600 }}>Vendor</td><td style={{ padding: '6px 10px', border: '1px solid #eee' }}>{data.vendor_name ?? '—'}</td></tr>
          <tr><td style={{ padding: '6px 10px', background: '#f9fafb', border: '1px solid #eee', fontWeight: 600 }}>Amount</td><td style={{ padding: '6px 10px', border: '1px solid #eee', fontWeight: 700 }}>{money(data.amount)}</td></tr>
        </tbody>
      </table>

      {mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setError(null); setMode('approve') }} style={btn('#16a34a')}>Approve</button>
          <button onClick={() => { setError(null); setMode('revision') }} style={btn('#9ca3af')}>Request revision</button>
        </div>
      )}

      {mode === 'approve' && (
        <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 6 }}>Your signature</div>
          {data.saved_signature && !redraw ? (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.saved_signature} alt="Your signature" style={{ height: 70, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', padding: 4 }} />
              <div style={{ marginTop: 6 }}><button onClick={() => { setRedraw(true); setSig(null) }} style={{ background: 'none', border: 'none', color: '#f26a1b', fontSize: 12, cursor: 'pointer', padding: 0 }}>Draw a new signature</button></div>
            </div>
          ) : (
            <SignaturePad onChange={setSig} />
          )}
          {error && <div style={{ fontSize: 13, color: '#991b1b', marginTop: 8 }}>⚠ {error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => submit('approve')} disabled={busy} style={btn('#16a34a')}>{busy ? '…' : 'Approve & sign'}</button>
            <button onClick={() => setMode('idle')} disabled={busy} style={{ ...btn('#fff'), color: '#374151', border: '1px solid #d1d5db' }}>Back</button>
          </div>
        </div>
      )}

      {mode === 'revision' && (
        <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 6 }}>What should be revised?</div>
          <textarea value={comments} onChange={e => setComments(e.target.value)} rows={3} placeholder="e.g. Get an itemized breakdown from the vendor." style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
          {error && <div style={{ fontSize: 13, color: '#991b1b', marginTop: 8 }}>⚠ {error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => submit('revision')} disabled={busy} style={btn('#f26a1b')}>{busy ? '…' : 'Request revision'}</button>
            <button onClick={() => setMode('idle')} disabled={busy} style={{ ...btn('#fff'), color: '#374151', border: '1px solid #d1d5db' }}>Back</button>
          </div>
        </div>
      )}

      {data.member && <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 14 }}>Signing as {data.member}</p>}
    </div>
  )
}

const btn = (bg: string): React.CSSProperties => ({ padding: '10px 18px', borderRadius: 8, border: 'none', background: bg, color: bg === '#fff' ? '#374151' : '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' })
