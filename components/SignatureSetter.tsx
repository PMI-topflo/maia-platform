'use client'

// Set a board member's on-file approval signature — either DRAW it or TYPE a
// name and pick a signature font. Saves a PNG data URL to signature_image,
// which is then reused automatically on approval letters (Board Decision Page).

import { useRef, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'

const FONTS = [
  { label: 'Flowing', css: "'Brush Script MT','Snell Roundhand','Segoe Script',cursive" },
  { label: 'Elegant', css: "'Snell Roundhand','Apple Chancery','Lucida Handwriting',cursive" },
  { label: 'Handwritten', css: "'Segoe Script','Bradley Hand','Lucida Handwriting',cursive" },
  { label: 'Classic cursive', css: 'cursive' },
]

function renderTyped(text: string, fontCss: string): string {
  const c = document.createElement('canvas'); c.width = 520; c.height = 150
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#111827'; ctx.textBaseline = 'middle'
  ctx.font = `64px ${fontCss}`
  ctx.fillText(text || ' ', 18, 82)
  return c.toDataURL('image/png')
}

export default function SignatureSetter({ code, email, name, hasSignature, onSaved }: {
  code: string; email: string; name: string | null; hasSignature: boolean; onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'draw' | 'type'>('type')
  const [drawn, setDrawn] = useState('')
  const [typed, setTyped] = useState(name ?? '')
  const [fontCss, setFontCss] = useState(FONTS[0].css)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  async function save(clear = false) {
    setBusy(true); setMsg(null)
    const signature = clear ? null : (tab === 'draw' ? drawn : renderTyped(typed.trim(), fontCss))
    if (!clear && !signature) { setMsg('Draw or type a signature first.'); setBusy(false); return }
    try {
      const r = await fetch('/api/admin/board-members/signature', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, email, signature }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      setOpen(false); onSaved()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} style={{ font: '600 11px system-ui', color: hasSignature ? '#166534' : '#2563eb', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        {hasSignature ? '✍ Signature on file — change' : '✍ Set approval signature'}
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ font: '700 15px system-ui', margin: 0 }}>Approval signature — {name ?? email}</h3>
              <button onClick={() => setOpen(false)} style={{ font: '600 13px system-ui', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: 6, margin: '12px 0' }}>
              {(['type', 'draw'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{ font: '600 12px system-ui', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${tab === t ? '#2563eb' : '#d1d5db'}`, background: tab === t ? '#eff6ff' : '#fff', color: tab === t ? '#1d4ed8' : '#374151' }}>{t === 'type' ? 'Type + choose font' : 'Draw'}</button>
              ))}
            </div>

            {tab === 'type' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Full name" style={{ font: '14px system-ui', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 8 }} />
                <select value={fontCss} onChange={e => setFontCss(e.target.value)} style={{ font: '13px system-ui', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8 }}>
                  {FONTS.map(f => <option key={f.label} value={f.css}>{f.label}</option>)}
                </select>
                <div ref={previewRef} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '18px 16px', minHeight: 70, display: 'flex', alignItems: 'center', fontSize: 40, color: '#111827', fontFamily: fontCss }}>{typed || 'Preview'}</div>
              </div>
            ) : (
              <div>
                <div style={{ font: '12px system-ui', color: '#6b7280', marginBottom: 6 }}>Draw the signature below:</div>
                <SignaturePad onChange={img => setDrawn(img ?? '')} />
              </div>
            )}

            {msg && <p style={{ font: '12px system-ui', color: '#991b1b', margin: '8px 0 0' }}>{msg}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
              <button onClick={() => save(false)} disabled={busy} style={{ font: '600 13px system-ui', background: busy ? '#9ca3af' : '#f26a1b', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: busy ? 'default' : 'pointer' }}>{busy ? 'Saving…' : 'Save signature'}</button>
              {hasSignature && <button onClick={() => save(true)} disabled={busy} style={{ font: '600 12px system-ui', color: '#991b1b', background: 'none', border: 'none', cursor: 'pointer' }}>Remove signature</button>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
