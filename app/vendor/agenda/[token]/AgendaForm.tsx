'use client'

import { useState } from 'react'

const STR = {
  en: { intro: (w: string) => `Confirm next week (week of ${w}): pick the crew who will service and the planned day.`, crew: 'Crew for next week', day: 'Planned day (optional)', none: 'No crew on file yet — PMI can add them.', submit: 'Confirm agenda', sending: 'Confirming…', done: 'Thank you — next week is confirmed and your crew has been sent their upload link.', pick: 'Please select at least one crew member.' },
  es: { intro: (w: string) => `Confirme la próxima semana (semana del ${w}): elija el equipo que dará el servicio y el día previsto.`, crew: 'Equipo para la próxima semana', day: 'Día previsto (opcional)', none: 'Aún no hay empleados registrados — PMI puede agregarlos.', submit: 'Confirmar agenda', sending: 'Confirmando…', done: 'Gracias — la próxima semana está confirmada y su equipo recibió el enlace para subir fotos.', pick: 'Por favor seleccione al menos un empleado.' },
} as const

export default function AgendaForm({ token, lang = 'en', weekOf, crew }: { token: string; lang?: 'en' | 'es'; weekOf: string; crew: { id: string; name: string }[] }) {
  const t = STR[lang] ?? STR.en
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) { setPicked(p => ({ ...p, [id]: !p[id] })) }

  async function submit() {
    const ids = Object.keys(picked).filter(k => picked[k])
    if (ids.length === 0) { setError(t.pick); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/vendor/agenda/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: ids, plannedDate: day || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error ?? 'Failed')
      setDone(true)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (done) return <div style={{ marginTop: 16, padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46' }}>✓ {t.done}</div>

  return (
    <div>
      <p style={{ fontSize: 13, color: '#4b5563', margin: '14px 0 14px', lineHeight: 1.5 }}>{t.intro(weekOf)}</p>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}>{t.crew}</div>
      {crew.length === 0 && <p style={{ fontSize: 13, color: '#9ca3af' }}>{t.none}</p>}
      {crew.map(c => (
        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 14 }}>
          <input type="checkbox" checked={!!picked[c.id]} onChange={() => toggle(c.id)} /> {c.name}
        </label>
      ))}
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', margin: '12px 0 4px' }}>{t.day}</div>
      <input type="date" value={day} onChange={e => setDay(e.target.value)} style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }} />
      {error && <div style={{ fontSize: 13, color: '#991b1b', margin: '10px 0' }}>⚠ {error}</div>}
      <button onClick={submit} disabled={busy || crew.length === 0} style={{ display: 'block', width: '100%', marginTop: 16, padding: 11, borderRadius: 8, border: 'none', background: busy ? '#9ca3af' : '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? t.sending : t.submit}
      </button>
    </div>
  )
}
