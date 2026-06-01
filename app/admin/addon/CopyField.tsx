'use client'

// Client-side copyable field for the add-on connect page. The page itself
// is a server component (needs the session + token mint), so the
// interactive bits (click-to-select, Copy button) live here.

import { useState } from 'react'

export default function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked — user can still select manually */ }
  }

  const field: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280' }}>{label}</label>
        <button
          onClick={copy}
          style={{ fontSize: 11, fontWeight: 600, color: copied ? '#059669' : '#f26a1b', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {multiline ? (
        <textarea
          readOnly
          value={value}
          rows={4}
          onFocus={e => e.currentTarget.select()}
          style={{ ...field, fontFamily: 'var(--font-mono, monospace)', fontSize: 11, resize: 'vertical' }}
        />
      ) : (
        <input
          readOnly
          value={value}
          onFocus={e => e.currentTarget.select()}
          style={field}
        />
      )}
    </div>
  )
}
