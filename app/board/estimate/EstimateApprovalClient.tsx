'use client'

// Board estimate-approval responder — a side-by-side comparison of EVERY
// submitted vendor (amount · scope · the estimate itself shown inline as
// images). The board member picks one vendor, then Approves (e-sign; saved
// signature reused or re-drawn) or Requests a revision (with a comment).

import { useEffect, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'

interface VRow { id: string; vendor_name: string | null; amount: number | null; summary: string | null; status: string }
interface Data {
  decided: boolean; member: string | null
  ticket: { number: string | null; subject: string | null }
  scope: string | null; required: number; status: string
  recommended_vendor_request_id: string | null
  winner_vendor_request_id: string | null
  vendors: VRow[]
  saved_signature: string | null
}
const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function EstimateApprovalClient({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [pagesByErv, setPagesByErv] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>('')
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
      .then((d: Data & { error?: string }) => {
        if (!live) return
        if (d.error) { setError(d.error); return }
        setData(d); setSig(d.saved_signature ?? null)
        // Default selection: staff recommendation, else cheapest (first).
        const def = d.recommended_vendor_request_id && d.vendors.some(v => v.id === d.recommended_vendor_request_id)
          ? d.recommended_vendor_request_id : (d.vendors[0]?.id ?? '')
        setSelected(def)
        // Lazy-load each vendor's estimate pages in parallel.
        for (const v of d.vendors) {
          fetch(`/api/board/estimate/preview?token=${encodeURIComponent(token)}&erv=${encodeURIComponent(v.id)}`).then(r => r.json())
            .then((p: { pages?: string[] }) => { if (live) setPagesByErv(prev => ({ ...prev, [v.id]: p.pages ?? [] })) }).catch(() => {})
        }
      })
      .catch(() => setError('Could not load this approval.')).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [token])

  async function submit(decision: 'approve' | 'revision') {
    if (decision === 'approve' && !selected) { setError('Please choose a vendor to approve.'); return }
    if (decision === 'approve' && !sig) { setError('Please add your signature.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/board/estimate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decision, selected_vendor_request_id: decision === 'approve' ? selected : undefined, signature: decision === 'approve' ? sig : undefined, comments }),
      })
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

  const amounts = data.vendors.map(v => v.amount).filter((n): n is number => n != null)
  const lowest = amounts.length ? Math.min(...amounts) : null

  return (
    <div style={card}>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>Estimate approval</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>{data.ticket.number ?? ''}{data.ticket.subject ? ` — ${data.ticket.subject}` : ''} · needs {data.required} approval{data.required === 1 ? '' : 's'}</div>
      {data.scope && <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', background: '#f9fafb', border: '1px solid #f1f5f9', borderRadius: 8, padding: '8px 10px', marginBottom: 14 }}><strong style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase' }}>Scope</strong><br />{data.scope}</div>}

      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: 8 }}>Compare the estimates — pick one to approve</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {data.vendors.map(v => {
          const isSel = selected === v.id
          const isLow = v.amount != null && v.amount === lowest && amounts.length > 1
          const isRec = v.id === data.recommended_vendor_request_id
          const pages = pagesByErv[v.id]
          return (
            <label key={v.id} style={{ display: 'block', border: `2px solid ${isSel ? '#16a34a' : '#e5e7eb'}`, borderRadius: 10, padding: 12, cursor: 'pointer', background: isSel ? '#f0fdf4' : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <input type="radio" name="vendor" checked={isSel} onChange={() => setSelected(v.id)} style={{ marginTop: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                      {v.vendor_name ?? '—'}
                      {isRec && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>★ RECOMMENDED</span>}
                      {isLow && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#047857', background: '#d1fae5', padding: '1px 6px', borderRadius: 4 }}>LOWEST</span>}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>{money(v.amount)}</div>
                  </div>
                  {v.summary && <div style={{ fontSize: 12.5, color: '#475569', marginTop: 4, whiteSpace: 'pre-wrap' }}>{v.summary}</div>}

                  {/* The estimate itself, inline. */}
                  {pages === undefined && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>Loading estimate…</div>}
                  {pages && pages.length > 0 && (
                    <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', maxHeight: 420, overflowY: 'auto' }}>
                      {pages.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={src} alt={`${v.vendor_name ?? 'Estimate'} page ${i + 1}`} style={{ display: 'block', width: '100%', borderTop: i ? '1px solid #eee' : 'none' }} />
                      ))}
                    </div>
                  )}
                  {pages && pages.length === 0 && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>No estimate file on record.</div>}
                </div>
              </div>
            </label>
          )
        })}
      </div>

      {mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setError(null); setMode('approve') }} style={btn('#16a34a')}>Approve selected</button>
          <button onClick={() => { setError(null); setMode('revision') }} style={btn('#9ca3af')}>Request revision</button>
        </div>
      )}

      {mode === 'approve' && (
        <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>Approving <strong>{data.vendors.find(v => v.id === selected)?.vendor_name ?? '—'}</strong> · {money(data.vendors.find(v => v.id === selected)?.amount ?? null)}</div>
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
