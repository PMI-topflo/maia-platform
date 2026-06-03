// =====================================================================
// app/admin/ideas/IdeasBoard.tsx
//
// Triage board for staff MAIA-improvement ideas. Lists New / Accepted /
// Done columns; each card moves between states (Accept → Done) or is
// deleted (soft). Reads + writes /api/admin/ideas.
// =====================================================================
'use client'

import { useEffect, useState, useCallback } from 'react'

const NAVY   = '#1f2a44'
const ORANGE = '#f26a1b'

interface Idea {
  id:                 string
  idea:               string
  submitted_by_name:  string | null
  submitted_by_email: string | null
  source:             string
  status:             'new' | 'accepted' | 'done' | 'deleted'
  triaged_by:         string | null
  triaged_at:         string | null
  created_at:         string
}

const COLUMNS: Array<{ key: Idea['status']; label: string; tint: string }> = [
  { key: 'new',      label: 'New',      tint: '#eff6ff' },
  { key: 'accepted', label: 'Accepted', tint: '#fef9ec' },
  { key: 'done',     label: 'Done',     tint: '#ecfdf5' },
]

export default function IdeasBoard() {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/admin/ideas', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      setIdeas(d.ideas ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function setStatus(id: string, status: Idea['status']) {
    setBusyId(id)
    try {
      const r = await fetch('/api/admin/ideas', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d?.error ?? `HTTP ${r.status}`) }
      // Local update (deleted rows drop out of view).
      setIdeas(prev => status === 'deleted' ? prev.filter(i => i.id !== id) : prev.map(i => i.id === id ? { ...i, status } : i))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusyId(null) }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  async function sendDailyNews() {
    // Preview the recipient list first so the confirm names real people.
    setSendMsg(null)
    let recipients: string[] = []
    try {
      const p = await fetch('/api/admin/daily-news/send', { cache: 'no-store' })
      const d = await p.json()
      if (!p.ok) throw new Error(d?.error ?? `HTTP ${p.status}`)
      recipients = d.recipients ?? []
    } catch (e) { setSendMsg(`Couldn't load recipients: ${e instanceof Error ? e.message : String(e)}`); return }

    if (recipients.length === 0) { setSendMsg('No human staff recipients found — nothing sent.'); return }
    if (!confirm(`Send "PMI Top Florida Daily News" now to ${recipients.length} staff?\n\n${recipients.join('\n')}`)) return

    setSending(true)
    try {
      const r = await fetch('/api/admin/daily-news/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      if (!r.ok || !d.ok) throw new Error(d?.error ?? d?.reason ?? `HTTP ${r.status}`)
      setSendMsg(`✅ Sent to ${d.recipients.length} staff: ${d.recipients.join(', ')}`)
    } catch (e) { setSendMsg(`Send failed: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setSending(false) }
  }

  function Card({ i }: { i: Idea }) {
    const disabled = busyId === i.id
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'pre-wrap' }}>{i.idea}</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
          {i.submitted_by_name || 'Anonymous'} · {fmtDate(i.created_at)}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {i.status === 'new' && (
            <button disabled={disabled} onClick={() => setStatus(i.id, 'accepted')} style={btn(ORANGE, true)}>Accept</button>
          )}
          {i.status === 'accepted' && (
            <button disabled={disabled} onClick={() => setStatus(i.id, 'done')} style={btn('#15803d', true)}>Mark done</button>
          )}
          {i.status !== 'new' && (
            <button disabled={disabled} onClick={() => setStatus(i.id, 'new')} style={btn('#6b7280', false)}>↩ New</button>
          )}
          <button disabled={disabled} onClick={() => { if (confirm('Delete this idea?')) void setStatus(i.id, 'deleted') }} style={btn('#b91c1c', false)}>Delete</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: NAVY, margin: 0 }}>💡 MAIA Improvement Ideas</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void sendDailyNews()} disabled={sending}
            style={{ ...btn(ORANGE, true), padding: '6px 12px', fontSize: 12, opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Sending…' : '📣 Send Daily News now'}
          </button>
          <button onClick={() => void load()} style={btn('#6b7280', false)}>Refresh</button>
        </div>
      </div>
      {sendMsg && <div style={{ background: sendMsg.startsWith('✅') ? '#ecfdf5' : '#fef3c7', border: `1px solid ${sendMsg.startsWith('✅') ? '#86efac' : '#fcd34d'}`, color: sendMsg.startsWith('✅') ? '#065f46' : '#92400e', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{sendMsg}</div>}
      {error && <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {loading ? (
        <div style={{ color: '#6b7280', fontSize: 14 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {COLUMNS.map(col => {
            const items = ideas.filter(i => i.status === col.key)
            return (
              <div key={col.key} style={{ background: col.tint, borderRadius: 10, padding: 12, minHeight: 120 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
                  {col.label} <span style={{ color: '#9ca3af' }}>({items.length})</span>
                </div>
                {items.length === 0 ? <div style={{ fontSize: 12, color: '#9ca3af' }}>Nothing here.</div> : items.map(i => <Card key={i.id} i={i} />)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function btn(color: string, filled: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
    border: `1px solid ${color}`, background: filled ? color : '#fff', color: filled ? '#fff' : color,
  }
}
