'use client'

// Board estimate-approval responder — see the chosen vendor + amount +
// scope + comparison + PDF, then Approve (e-sign; saved signature reused or
// re-drawn) or Request revision (with a comment).

import { useEffect, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'

interface CompRow { vendor_name: string | null; amount: number | null; status: string }
interface Data {
  decided: boolean; member: string | null
  approval: { vendor_name: string | null; amount: number | null; scope: string | null; status: string; required: number }
  ticket: { number: string | null; subject: string | null }
  comparison: CompRow[]; estimate_url: string | null; saved_signature: string | null
}
const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function EstimateApprovalClient({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [pages, setPages] = useState<string[]>([])
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
    fetch(`/api/board/estimate?token=${encodeURIComponent(token)}`).then(r => r.json())
      .then((d: Data & { error?: string }) => { if (!live) return; if (d.error) setError(d.error); else { setData(d); setSig(d.saved_signature ?? null) } })
      .catch(() => setError('Could not load this approval.')).finally(() => { if (live) setLoading(false) })
    // Inline image preview of the estimate (no download for the board).
    fetch(`/api/board/estimate/preview?token=${encodeURIComponent(token)}`).then(r => r.json())
      .then((d: { pages?: string[] }) => { if (live) setPages(d.pages ?? []) }).catch(() => {})
    return () => { live = false }
  }, [token])

  async function submit(decision: 'approve' | 'revision') {
    if (decision === 'approve' && !sig) { setError('Please add your signature.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/board/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, decision, signature: decision === 'approve' ? sig : undefined, comments }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setDone(decision === 'approve' ? (d.status === 'approved' ? 'Approved — the board threshold is met. Thank you!' : 'Your approval is recorded. Thank you!') : 'Revision requested — PMI has been notified. Thank you!')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }
  if (loading) return <div style={card}>Loading…</div>
  if (error && !data) return <div style={{ ...card, color: '#991b1b' }}>{error}</div>
  if (!data) return null
  if (done) return <div style={{ ...card, background: '#ecfdf5', color: '#065f46' }}>✓ {done}</div>
  if (data.decided) return <div style={{ ...card, color: '#374151' }}>You&apos;ve already submitted a decision on this estimate. Thank you.</div>

  const a = data.approval
  return (
    <div style={card}>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>Estimate approval</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>{data.ticket.number ?? ''}{data.ticket.subject ? ` — ${data.ticket.subject}` : ''} · needs {a.required} approval{a.required === 1 ? '' : 's'}</div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{a.vendor_name ?? '—'}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{money(a.amount)}</div>
        </div>
        {a.scope && <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', marginTop: 6 }}>{a.scope}</div>}
      </div>

      {/* The estimate itself, shown inline as images — no download needed. */}
      {pages.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}>The estimate</div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            {pages.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt={`Estimate page ${i + 1}`} style={{ display: 'block', width: '100%', borderTop: i ? '1px solid #eee' : 'none' }} />
            ))}
          </div>
          {data.estimate_url && <div style={{ marginTop: 6 }}><a href={data.estimate_url} target="_blank" rel="noreferrer" style={{ color: '#6b7280', fontSize: 12 }}>Open the original file ↗</a></div>}
        </div>
      )}
      {pages.length === 0 && data.estimate_url && (
        <div style={{ marginBottom: 14 }}><a href={data.estimate_url} target="_blank" rel="noreferrer" style={{ color: '#f26a1b', fontWeight: 600, fontSize: 13 }}>View the estimate →</a></div>
      )}

      {data.comparison.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>All estimates</div>
          {data.comparison.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderTop: i ? '1px solid #f1f5f9' : 'none', color: c.vendor_name === a.vendor_name ? '#0f172a' : '#6b7280', fontWeight: c.vendor_name === a.vendor_name ? 700 : 400 }}>
              <span>{c.vendor_name ?? '—'}{c.vendor_name === a.vendor_name ? ' (selected)' : ''}</span><span>{money(c.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setMode('approve')} style={btn('#16a34a')}>Approve</button>
          <button onClick={() => setMode('revision')} style={btn('#9ca3af')}>Request revision</button>
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
          <textarea value={comments} onChange={e => setComments(e.target.value)} rows={3} placeholder="e.g. Get a second quote, or ask the vendor to itemize labor vs materials." style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }} />
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
