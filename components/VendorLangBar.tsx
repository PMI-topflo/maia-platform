'use client'

// Language switcher for the token-gated vendor pages (upload + agenda).
// Changing the picker reloads the same URL with ?lang=<new> (preserving
// every other param, e.g. the ?e= crew token), so the server re-renders
// all strings. When the viewed language differs from the saved default
// and a saveEndpoint is provided, it offers "save as my default" — POSTing
// { lang } to that endpoint (crew → preferred_language, office → office_language).

import { useState } from 'react'

export const LANG_LABEL: Record<string, string> = {
  en: 'English', es: 'Español', pt: 'Português', fr: 'Français', he: 'עברית', ru: 'Русский', ht: 'Kreyòl',
}

type Bar = { label: string; saveQ: (n: string) => string; save: string; saving: string; saved: string; dismiss: string }
const STR: Record<string, Bar> = {
  en: { label: 'Language', saveQ: n => `Make ${n} your default for future messages?`, save: 'Save', saving: 'Saving…', saved: 'Saved ✓', dismiss: 'Not now' },
  es: { label: 'Idioma', saveQ: n => `¿Hacer de ${n} su idioma predeterminado para los próximos mensajes?`, save: 'Guardar', saving: 'Guardando…', saved: 'Guardado ✓', dismiss: 'Ahora no' },
  pt: { label: 'Idioma', saveQ: n => `Tornar ${n} seu idioma padrão para as próximas mensagens?`, save: 'Salvar', saving: 'Salvando…', saved: 'Salvo ✓', dismiss: 'Agora não' },
  fr: { label: 'Langue', saveQ: n => `Définir ${n} comme votre langue par défaut pour les prochains messages ?`, save: 'Enregistrer', saving: 'Enregistrement…', saved: 'Enregistré ✓', dismiss: 'Plus tard' },
  he: { label: 'שפה', saveQ: n => `להגדיר את ${n} כשפת ברירת המחדל שלך להודעות הבאות?`, save: 'שמירה', saving: 'שומר…', saved: 'נשמר ✓', dismiss: 'לא עכשיו' },
  ru: { label: 'Язык', saveQ: n => `Сделать ${n} вашим языком по умолчанию для будущих сообщений?`, save: 'Сохранить', saving: 'Сохранение…', saved: 'Сохранено ✓', dismiss: 'Не сейчас' },
  ht: { label: 'Lang', saveQ: n => `Mete ${n} kòm lang default ou pou mesaj k ap vini yo?`, save: 'Anrejistre', saving: 'N ap anrejistre…', saved: 'Anrejistre ✓', dismiss: 'Pita' },
}

export default function VendorLangBar({ current, defaultLang, langs, saveEndpoint }: {
  current: string
  defaultLang?: string | null
  langs: string[]
  saveEndpoint?: string | null
}) {
  const t = STR[current] ?? STR.en
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'dismissed'>('idle')
  const [error, setError] = useState(false)

  function switchTo(next: string) {
    if (next === current) return
    const url = new URL(window.location.href)
    url.searchParams.set('lang', next)
    window.location.assign(url.toString())
  }

  async function save() {
    if (!saveEndpoint) return
    setState('saving'); setError(false)
    try {
      const r = await fetch(saveEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: current }) })
      if (!r.ok) throw new Error()
      setState('saved')
    } catch {
      setError(true); setState('idle')
    }
  }

  const offerSave = !!saveEndpoint && defaultLang != null && current !== defaultLang
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }
  const selectStyle: React.CSSProperties = { fontSize: 13, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', color: '#111827', cursor: 'pointer' }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{t.label}</span>
        <select value={current} onChange={e => switchTo(e.target.value)} style={selectStyle} aria-label={t.label}>
          {langs.map(l => <option key={l} value={l}>{LANG_LABEL[l] ?? l.toUpperCase()}</option>)}
        </select>
      </div>
      {offerSave && state !== 'saved' && state !== 'dismissed' && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, fontSize: 13, color: '#7c2d12', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 auto' }}>{t.saveQ(LANG_LABEL[current] ?? current)}</span>
          <button onClick={save} disabled={state === 'saving'} style={{ background: '#f26a1b', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {state === 'saving' ? t.saving : t.save}
          </button>
          <button onClick={() => setState('dismissed')} style={{ background: 'none', border: 'none', color: '#9a3412', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>{t.dismiss}</button>
        </div>
      )}
      {state === 'saved' && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#065f46', fontWeight: 600 }}>{t.saved}</div>
      )}
      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>⚠</div>
      )}
    </div>
  )
}
