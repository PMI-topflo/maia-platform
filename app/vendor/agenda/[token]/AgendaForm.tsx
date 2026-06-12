'use client'

import { useState } from 'react'

const STR = {
  en: { intro: (w: string) => `Confirm next week (week of ${w}): pick the crew who will service and the planned day.`, crew: 'Crew for next week', day: 'Planned day (optional)', none: 'No crew on file yet — add the people coming next week below.', submit: 'Confirm agenda', sending: 'Confirming…', done: 'Thank you — next week is confirmed and your crew has been sent their upload link.', pick: 'Please select at least one crew member.', addTitle: 'Add a crew member', namePh: 'Name', phonePh: 'Phone (for text/WhatsApp)', emailPh: 'Email', add: 'Add', adding: 'Adding…', needName: 'Enter a name.' },
  es: { intro: (w: string) => `Confirme la próxima semana (semana del ${w}): elija el equipo que dará el servicio y el día previsto.`, crew: 'Equipo para la próxima semana', day: 'Día previsto (opcional)', none: 'Aún no hay empleados — agregue abajo a quienes vendrán la próxima semana.', submit: 'Confirmar agenda', sending: 'Confirmando…', done: 'Gracias — la próxima semana está confirmada y su equipo recibió el enlace para subir fotos.', pick: 'Por favor seleccione al menos un empleado.', addTitle: 'Agregar un empleado', namePh: 'Nombre', phonePh: 'Teléfono (para texto/WhatsApp)', emailPh: 'Correo', add: 'Agregar', adding: 'Agregando…', needName: 'Ingrese un nombre.' },
  pt: { intro: (w: string) => `Confirme a próxima semana (semana de ${w}): escolha a equipe que fará o serviço e o dia previsto.`, crew: 'Equipe para a próxima semana', day: 'Dia previsto (opcional)', none: 'Ainda não há funcionários — adicione abaixo quem virá na próxima semana.', submit: 'Confirmar agenda', sending: 'Confirmando…', done: 'Obrigado — a próxima semana está confirmada e sua equipe recebeu o link para enviar fotos.', pick: 'Por favor selecione pelo menos um funcionário.', addTitle: 'Adicionar um funcionário', namePh: 'Nome', phonePh: 'Telefone (para texto/WhatsApp)', emailPh: 'E-mail', add: 'Adicionar', adding: 'Adicionando…', needName: 'Digite um nome.' },
  fr: { intro: (w: string) => `Confirmez la semaine prochaine (semaine du ${w}) : choisissez l'équipe qui interviendra et le jour prévu.`, crew: 'Équipe pour la semaine prochaine', day: 'Jour prévu (facultatif)', none: 'Aucun employé enregistré — ajoutez ci-dessous les personnes qui viendront la semaine prochaine.', submit: "Confirmer l'agenda", sending: 'Confirmation…', done: 'Merci — la semaine prochaine est confirmée et votre équipe a reçu son lien de téléversement.', pick: "Veuillez sélectionner au moins un membre de l'équipe.", addTitle: 'Ajouter un membre', namePh: 'Nom', phonePh: 'Téléphone (pour SMS/WhatsApp)', emailPh: 'E-mail', add: 'Ajouter', adding: 'Ajout…', needName: 'Entrez un nom.' },
  he: { intro: (w: string) => `אשרו את השבוע הבא (השבוע של ${w}): בחרו את הצוות שיבצע את השירות ואת היום המתוכנן.`, crew: 'צוות לשבוע הבא', day: 'יום מתוכנן (אופציונלי)', none: 'אין עדיין עובדים רשומים — הוסיפו למטה את האנשים שיגיעו בשבוע הבא.', submit: 'אישור סדר היום', sending: 'מאשר…', done: 'תודה — השבוע הבא אושר והצוות שלכם קיבל קישור להעלאת תמונות.', pick: 'אנא בחרו לפחות חבר צוות אחד.', addTitle: 'הוספת חבר צוות', namePh: 'שם', phonePh: 'טלפון (לסמס/וואטסאפ)', emailPh: 'דוא"ל', add: 'הוסף', adding: 'מוסיף…', needName: 'הזינו שם.' },
  ru: { intro: (w: string) => `Подтвердите следующую неделю (неделя ${w}): выберите бригаду и планируемый день.`, crew: 'Бригада на следующую неделю', day: 'Планируемый день (необязательно)', none: 'Сотрудников пока нет — добавьте ниже тех, кто придёт на следующей неделе.', submit: 'Подтвердить план', sending: 'Подтверждение…', done: 'Спасибо — следующая неделя подтверждена, и вашей бригаде отправлена ссылка для загрузки фото.', pick: 'Пожалуйста, выберите хотя бы одного сотрудника.', addTitle: 'Добавить сотрудника', namePh: 'Имя', phonePh: 'Телефон (для SMS/WhatsApp)', emailPh: 'Эл. почта', add: 'Добавить', adding: 'Добавление…', needName: 'Введите имя.' },
  ht: { intro: (w: string) => `Konfime semèn pwochèn (semèn ${w}): chwazi ekip ki pral fè sèvis la ak jou ki planifye a.`, crew: 'Ekip pou semèn pwochèn', day: 'Jou ki planifye (opsyonèl)', none: 'Pa gen anplwaye anrejistre — ajoute anba moun ki pral vini semèn pwochèn.', submit: 'Konfime ajanda', sending: 'N ap konfime…', done: 'Mèsi — semèn pwochèn konfime epi ekip ou a resevwa lyen pou voye foto.', pick: 'Tanpri chwazi omwen yon manm ekip.', addTitle: 'Ajoute yon manm ekip', namePh: 'Non', phonePh: 'Telefòn (pou tèks/WhatsApp)', emailPh: 'Imèl', add: 'Ajoute', adding: 'N ap ajoute…', needName: 'Antre yon non.' },
} as const

export default function AgendaForm({ token, lang = 'en', weekOf, crew: initialCrew }: { token: string; lang?: keyof typeof STR; weekOf: string; crew: { id: string; name: string }[] }) {
  const t = STR[lang] ?? STR.en
  const [crew, setCrew] = useState(initialCrew)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // "Add a person" mini-form — office self-registers a new crew member.
  const [np, setNp] = useState({ name: '', phone: '', email: '' })
  const [adding, setAdding] = useState(false)

  function toggle(id: string) { setPicked(p => ({ ...p, [id]: !p[id] })) }

  async function addPerson() {
    if (!np.name.trim()) { setError(t.needName); return }
    setAdding(true); setError(null)
    try {
      const res = await fetch(`/api/vendor/agenda/${token}/add-crew`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...np, preferred_channel: np.phone ? 'whatsapp' : 'email', preferred_language: lang }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error ?? 'Failed')
      setCrew(c => [...c, { id: j.employee.id, name: j.employee.name }])
      setPicked(p => ({ ...p, [j.employee.id]: true }))   // auto-select the new person
      setNp({ name: '', phone: '', email: '' })
    } catch (e) { setError((e as Error).message) } finally { setAdding(false) }
  }

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

      {/* Office self-registers a new crew member */}
      <div style={{ marginTop: 14, padding: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}>{t.addTitle}</div>
        <input placeholder={t.namePh} value={np.name} onChange={e => setNp({ ...np, name: e.target.value })} style={inp} />
        <input placeholder={t.phonePh} value={np.phone} onChange={e => setNp({ ...np, phone: e.target.value })} style={inp} />
        <input placeholder={t.emailPh} value={np.email} onChange={e => setNp({ ...np, email: e.target.value })} style={inp} />
        <button onClick={addPerson} disabled={adding} style={{ marginTop: 4, padding: '7px 14px', borderRadius: 6, border: '1px solid #f26a1b', background: '#fff', color: '#c2410c', fontSize: 13, fontWeight: 600, cursor: adding ? 'default' : 'pointer' }}>
          {adding ? t.adding : `+ ${t.add}`}
        </button>
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', margin: '12px 0 4px' }}>{t.day}</div>
      <input type="date" value={day} onChange={e => setDay(e.target.value)} style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }} />
      {error && <div style={{ fontSize: 13, color: '#991b1b', margin: '10px 0' }}>⚠ {error}</div>}
      <button onClick={submit} disabled={busy || crew.length === 0} style={{ display: 'block', width: '100%', marginTop: 16, padding: 11, borderRadius: 8, border: 'none', background: (busy || crew.length === 0) ? '#9ca3af' : '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? t.sending : t.submit}
      </button>
    </div>
  )
}

const inp: React.CSSProperties = { display: 'block', width: '100%', padding: '7px 9px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 6, boxSizing: 'border-box' }
