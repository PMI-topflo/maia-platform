'use client'

// =====================================================================
// PortalLangBar.tsx
//
// Language switcher for the resident portal. Mirrors the vendor-page
// idiom: changing the picker reloads the same URL with ?lang=<new>
// (preserving every other param, e.g. ?preview=owner), so the server
// re-renders all strings in the chosen language.
// =====================================================================

import { PORTAL_LANGS, PORTAL_LANG_LABEL, type PortalLang } from '@/lib/portal-i18n'

export default function PortalLangBar({ current, label }: { current: PortalLang; label: string }) {
  function switchTo(next: string) {
    if (next === current) return
    const url = new URL(window.location.href)
    url.searchParams.set('lang', next)
    window.location.assign(url.toString())
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🌐 {label}</span>
      <select
        value={current}
        onChange={e => switchTo(e.target.value)}
        aria-label={label}
        dir="ltr"
        style={{
          fontSize: 13, padding: '3px 8px', borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.10)',
          color: '#fff', cursor: 'pointer',
        }}
      >
        {PORTAL_LANGS.map(l => (
          <option key={l} value={l} style={{ color: '#111' }}>{PORTAL_LANG_LABEL[l]}</option>
        ))}
      </select>
    </div>
  )
}
