'use client'

// Public token-gated page: shows a drafted reply from the Gmail add-on with
// a REAL copy button. Opened via CardService's OpenLink from the sidebar
// card, which has no native clipboard-write API — this page runs as normal
// browser JS with full navigator.clipboard access. No login — the token in
// the URL is the credential. See lib/addon-draft-views.ts.

import { use, useEffect, useState } from 'react'

export default function DraftView({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch(`/api/addon/draft/${token}`).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(d => setText(d.draftText)).catch(e => setErr(String(e.message ?? e)))
  }, [token])

  async function copy() {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard API blocked (rare, non-HTTPS or permission denied) —
      // the textarea below is still there to select and copy by hand.
    }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#eceef2', fontFamily: 'system-ui', padding: '28px 16px' }
  const card: React.CSSProperties = { maxWidth: 640, margin: '0 auto', background: '#fff', border: '1px solid #e7e2d9', borderRadius: 14, padding: '30px 32px' }

  if (err) return <div style={wrap}><div style={card}><h1 style={{ font: '800 20px Georgia,serif', color: '#1c2333' }}>Link unavailable</h1><p style={{ color: '#6b7280' }}>{err}</p></div></div>
  if (!text) return <div style={wrap}><div style={card}><p style={{ color: '#9ca3af' }}>Loading…</p></div></div>

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ font: '700 11px system-ui', letterSpacing: '.14em', textTransform: 'uppercase', color: '#c0571a', marginBottom: 10 }}>PMI Top Florida Properties · MAIA</div>
        <h1 style={{ font: '800 24px/1.2 Georgia,serif', color: '#1c2333', margin: '0 0 6px' }}>Drafted reply</h1>
        <p style={{ font: '13px system-ui', color: '#6b7280', margin: '0 0 16px' }}>Copy this, then paste it into your reply in Gmail.</p>
        <textarea readOnly value={text} onClick={e => e.currentTarget.select()}
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 320, padding: 14, border: '1px solid #d1d5db', borderRadius: 10, font: '13.5px/1.5 ui-monospace, monospace', color: '#1c2333', resize: 'vertical' }} />
        <button onClick={copy} style={{ marginTop: 14, cursor: 'pointer', font: '700 14px system-ui', color: '#fff', background: copied ? '#166534' : '#c0571a', border: 'none', borderRadius: 9, padding: '11px 20px' }}>
          {copied ? '✓ Copied' : '📋 Copy to clipboard'}
        </button>
        <p style={{ font: '12px system-ui', color: '#9ca3af', marginTop: 20, borderTop: '1px solid #e7e2d9', paddingTop: 14 }}>You can close this tab once you&apos;ve pasted it.</p>
      </div>
    </div>
  )
}
