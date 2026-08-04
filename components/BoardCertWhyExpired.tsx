'use client'

// "Why is it expired?" — a board member (or staff/manager showing them) can
// open this to read, in plain language, how Florida board-education
// certification works and why the status flipped. Content is split by
// association regime (condo Ch. 718 vs HOA Ch. 720) and available in all 7
// portal languages, with its own inline language switcher (these surfaces
// have no global language bar). Hebrew renders right-to-left.

import { useState } from 'react'
import { PORTAL_LANGS, PORTAL_LANG_LABEL, isRtl, type PortalLang } from '@/lib/portal-i18n'
import { certRuleStrings } from '@/lib/board-cert-rules-i18n'
import type { CertKind } from '@/lib/board-certification'

export default function BoardCertWhyExpired({ kind, defaultLang = 'en' }: { kind: CertKind; defaultLang?: PortalLang }) {
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState<PortalLang>(defaultLang)
  const s = certRuleStrings(lang)
  const c = s[kind]
  const rtl = isRtl(lang)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ font: '600 11px system-ui', color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}
      >
        ⓘ {s.whyButton}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            dir={rtl ? 'rtl' : 'ltr'}
            style={{ background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: rtl ? 'right' : 'left' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexDirection: rtl ? 'row-reverse' : 'row' }}>
              <select
                value={lang}
                onChange={e => setLang(e.target.value as PortalLang)}
                aria-label={s.langLabel}
                style={{ font: '13px system-ui', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 8 }}
              >
                {PORTAL_LANGS.map(l => <option key={l} value={l}>{PORTAL_LANG_LABEL[l]}</option>)}
              </select>
              <button onClick={() => setOpen(false)} style={{ font: '600 13px system-ui', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>✕ {s.close}</button>
            </div>

            <h2 style={{ font: '700 17px system-ui', color: '#111827', margin: '14px 0 6px' }}>{c.heading}</h2>
            <p style={{ font: '400 13px system-ui', color: '#374151', margin: '0 0 14px', lineHeight: 1.5 }}>{c.intro}</p>

            <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {c.items.map((it, i) => (
                <div key={i} style={{ borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
                  <dt style={{ font: '700 12px system-ui', color: '#111827' }}>{it.label}</dt>
                  <dd style={{ font: '400 13px system-ui', color: '#374151', margin: '2px 0 0', lineHeight: 1.5 }}>{it.text}</dd>
                </div>
              ))}
            </dl>

            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', margin: '14px 0', font: '500 13px system-ui', color: '#92400e', lineHeight: 1.5 }}>
              {c.ceHighlight}
            </div>

            <p style={{ font: '400 12px system-ui', color: '#6b7280', margin: '0 0 12px', lineHeight: 1.5 }}>{s.suspend}</p>

            <h3 style={{ font: '700 13px system-ui', color: '#166534', margin: '0 0 4px' }}>{s.clearTitle}</h3>
            <p style={{ font: '400 13px system-ui', color: '#374151', margin: 0, lineHeight: 1.5 }}>{s.clearText}</p>
          </div>
        </div>
      )}
    </>
  )
}
