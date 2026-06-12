'use client'

import { useState } from 'react'

const STR = {
  en: {
    cats: { estimate: 'Estimate', invoice: 'Invoice', photos: 'Job photos' },
    reportPhotos: 'Brief report — what work was done?', reportNote: 'Note (optional)',
    reportPh: 'e.g. Mowed and edged front + rear common areas, blew walkways, trimmed hedges by pool gate.',
    notePh: 'Optional note for PMI.',
    suggLabel: 'Suggestions / issues noticed (optional)',
    suggPh: 'e.g. Sprinkler head broken near unit 12; palm by entrance needs trimming next visit.',
    chooseFile: 'Choose at least one file.', needReport: 'Please add a brief report of the work done.',
    upload: 'Upload', uploading: 'Uploading…', files: 'files', file: 'file',
    thanks: (n: number) => `Thank you — ${n} file(s) received. PMI has been notified.`,
    uploadMore: 'Upload more', autoCompress: 'Large photos are compressed automatically. Max 25 MB per file.',
  },
  es: {
    cats: { estimate: 'Estimado', invoice: 'Factura', photos: 'Fotos del trabajo' },
    reportPhotos: 'Informe breve — ¿qué trabajo se hizo?', reportNote: 'Nota (opcional)',
    reportPh: 'p. ej. Corté y bordeé las áreas comunes del frente y atrás, soplé las aceras, podé los setos junto a la piscina.',
    notePh: 'Nota opcional para PMI.',
    suggLabel: 'Sugerencias / problemas observados (opcional)',
    suggPh: 'p. ej. Aspersor roto cerca de la unidad 12; la palmera de la entrada necesita poda la próxima visita.',
    chooseFile: 'Elija al menos un archivo.', needReport: 'Por favor agregue un informe breve del trabajo realizado.',
    upload: 'Subir', uploading: 'Subiendo…', files: 'archivos', file: 'archivo',
    thanks: (n: number) => `Gracias — se recibieron ${n} archivo(s). PMI ha sido notificado.`,
    uploadMore: 'Subir más', autoCompress: 'Las fotos grandes se comprimen automáticamente. Máx. 25 MB por archivo.',
  },
  pt: {
    cats: { estimate: 'Orçamento', invoice: 'Fatura', photos: 'Fotos do trabalho' },
    reportPhotos: 'Relatório breve — que trabalho foi feito?', reportNote: 'Nota (opcional)',
    reportPh: 'ex. Cortei e aparei as áreas comuns da frente e dos fundos, soprei as calçadas, podei as cercas vivas junto ao portão da piscina.',
    notePh: 'Nota opcional para a PMI.',
    suggLabel: 'Sugestões / problemas observados (opcional)',
    suggPh: 'ex. Aspersor quebrado perto da unidade 12; a palmeira da entrada precisa de poda na próxima visita.',
    chooseFile: 'Escolha pelo menos um arquivo.', needReport: 'Por favor adicione um breve relatório do trabalho realizado.',
    upload: 'Enviar', uploading: 'Enviando…', files: 'arquivos', file: 'arquivo',
    thanks: (n: number) => `Obrigado — ${n} arquivo(s) recebido(s). A PMI foi notificada.`,
    uploadMore: 'Enviar mais', autoCompress: 'Fotos grandes são compactadas automaticamente. Máx. 25 MB por arquivo.',
  },
  fr: {
    cats: { estimate: 'Devis', invoice: 'Facture', photos: 'Photos du travail' },
    reportPhotos: 'Bref rapport — quel travail a été effectué ?', reportNote: 'Note (facultatif)',
    reportPh: 'ex. Tondu et bordé les espaces communs avant et arrière, soufflé les allées, taillé les haies près du portail de la piscine.',
    notePh: 'Note facultative pour PMI.',
    suggLabel: 'Suggestions / problèmes constatés (facultatif)',
    suggPh: "ex. Arroseur cassé près de l'unité 12 ; le palmier de l'entrée doit être taillé à la prochaine visite.",
    chooseFile: 'Choisissez au moins un fichier.', needReport: 'Veuillez ajouter un bref rapport du travail effectué.',
    upload: 'Téléverser', uploading: 'Téléversement…', files: 'fichiers', file: 'fichier',
    thanks: (n: number) => `Merci — ${n} fichier(s) reçu(s). PMI a été notifié.`,
    uploadMore: 'Téléverser plus', autoCompress: 'Les grandes photos sont compressées automatiquement. Max 25 Mo par fichier.',
  },
  he: {
    cats: { estimate: 'הצעת מחיר', invoice: 'חשבונית', photos: 'תמונות העבודה' },
    reportPhotos: 'דוח קצר — איזו עבודה בוצעה?', reportNote: 'הערה (אופציונלי)',
    reportPh: 'לדוגמה: כיסחתי ויישרתי את השטחים המשותפים מלפנים ומאחור, ניקיתי את השבילים, גזמתי את הגדרות החיות ליד שער הבריכה.',
    notePh: 'הערה אופציונלית ל-PMI.',
    suggLabel: 'הצעות / בעיות שנצפו (אופציונלי)',
    suggPh: 'לדוגמה: ממטרה שבורה ליד יחידה 12; הדקל בכניסה זקוק לגיזום בביקור הבא.',
    chooseFile: 'בחרו לפחות קובץ אחד.', needReport: 'אנא הוסיפו דוח קצר על העבודה שבוצעה.',
    upload: 'העלאה', uploading: 'מעלה…', files: 'קבצים', file: 'קובץ',
    thanks: (n: number) => `תודה — התקבלו ${n} קבצים. PMI קיבלה הודעה.`,
    uploadMore: 'העלאת עוד', autoCompress: 'תמונות גדולות נדחסות אוטומטית. מקסימום 25MB לקובץ.',
  },
  ru: {
    cats: { estimate: 'Смета', invoice: 'Счёт', photos: 'Фото работ' },
    reportPhotos: 'Краткий отчёт — какая работа выполнена?', reportNote: 'Заметка (необязательно)',
    reportPh: 'напр. Подстриг и выровнял общие зоны спереди и сзади, продул дорожки, подрезал живую изгородь у ворот бассейна.',
    notePh: 'Необязательная заметка для PMI.',
    suggLabel: 'Предложения / замеченные проблемы (необязательно)',
    suggPh: 'напр. Сломан разбрызгиватель у блока 12; пальму у входа нужно подрезать в следующий визит.',
    chooseFile: 'Выберите хотя бы один файл.', needReport: 'Пожалуйста, добавьте краткий отчёт о выполненной работе.',
    upload: 'Загрузить', uploading: 'Загрузка…', files: 'файлов', file: 'файл',
    thanks: (n: number) => `Спасибо — получено ${n} файл(ов). PMI уведомлена.`,
    uploadMore: 'Загрузить ещё', autoCompress: 'Большие фото сжимаются автоматически. Макс. 25 МБ на файл.',
  },
  ht: {
    cats: { estimate: 'Estimasyon', invoice: 'Fakti', photos: 'Foto travay' },
    reportPhotos: 'Ti rapò — ki travay ki fèt?', reportNote: 'Nòt (opsyonèl)',
    reportPh: 'egz. Mwen koupe ak taye zòn komen devan ak dèyè, soufle wout yo, taye raje bò pòtay pisin nan.',
    notePh: 'Nòt opsyonèl pou PMI.',
    suggLabel: 'Sijesyon / pwoblèm ou wè (opsyonèl)',
    suggPh: 'egz. Tèt awozè kase bò inite 12; palmis bò antre a bezwen taye pwochèn vizit.',
    chooseFile: 'Chwazi omwen yon fichye.', needReport: 'Tanpri ajoute yon ti rapò sou travay ki fèt la.',
    upload: 'Voye', uploading: 'N ap voye…', files: 'fichye', file: 'fichye',
    thanks: (n: number) => `Mèsi — nou resevwa ${n} fichye. PMI resevwa notifikasyon.`,
    uploadMore: 'Voye plis', autoCompress: 'Gwo foto konprese otomatikman. Maksimòm 25 MB pa fichye.',
  },
} as const

export default function Uploader({ token, lang = 'en' }: { token: string; lang?: keyof typeof STR }) {
  const t = STR[lang] ?? STR.en
  const CATEGORIES = [
    { key: 'estimate', label: t.cats.estimate },
    { key: 'invoice',  label: t.cats.invoice },
    { key: 'photos',   label: t.cats.photos },
  ] as const

  const [category, setCategory]    = useState<string>('estimate')
  const [files, setFiles]          = useState<File[]>([])
  const [report, setReport]        = useState('')
  const [suggestions, setSuggestions] = useState('')
  const [busy, setBusy]            = useState(false)
  const [done, setDone]            = useState<string | null>(null)
  const [results, setResults]      = useState<{ name: string; ok: boolean; message: string }[]>([])
  const [error, setError]          = useState<string | null>(null)

  const reportLabel = category === 'photos' ? t.reportPhotos : t.reportNote

  async function submit() {
    if (!files.length) { setError(t.chooseFile); return }
    if (category === 'photos' && !report.trim()) { setError(t.needReport); return }
    setBusy(true); setError(null); setDone(null)
    try {
      const fd = new FormData()
      fd.set('category', category)
      fd.set('report', report)
      fd.set('suggestions', suggestions)
      fd.set('lang', lang)
      files.forEach(f => fd.append('files', f))
      const res = await fetch(`/api/vendor/upload/${token}`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error ?? `Upload failed (${res.status})`)
      setResults(Array.isArray(j.results) ? j.results : [])
      setDone(t.thanks(j.saved ?? files.length))
      setFiles([]); setReport(''); setSuggestions('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, fontSize: 14, color: '#065f46' }}>
        ✓ {done}
        {results.length > 0 && (
          <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none' }}>
            {results.map((r, i) => (
              <li key={i} style={{ fontSize: 12, color: r.ok ? '#065f46' : '#991b1b', padding: '3px 0', borderTop: i ? '1px solid #d1fae5' : 'none' }}>
                {r.message} <span style={{ color: '#6b7280' }}>— {r.name}</span>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 10 }}>
          <button onClick={() => { setDone(null); setResults([]) }} style={linkBtn}>{t.uploadMore}</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)} style={{
            padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: category === c.key ? '1px solid #f26a1b' : '1px solid #d1d5db',
            background: category === c.key ? '#fff7ed' : '#fff',
            color: category === c.key ? '#c2410c' : '#374151',
          }}>{c.label}</button>
        ))}
      </div>

      <input
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*"
        onChange={e => setFiles(Array.from(e.target.files ?? []))}
        style={{ display: 'block', width: '100%', fontSize: 13, marginBottom: 12 }}
      />

      {files.length > 0 && (
        <ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', fontSize: 12, color: '#4b5563' }}>
          {files.map((f, i) => <li key={i}>• {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)</li>)}
        </ul>
      )}

      <label style={fieldLabel}>{reportLabel}</label>
      <textarea
        value={report}
        onChange={e => setReport(e.target.value)}
        rows={3}
        placeholder={category === 'photos' ? t.reportPh : t.notePh}
        style={taStyle}
      />

      <label style={fieldLabel}>{t.suggLabel}</label>
      <textarea
        value={suggestions}
        onChange={e => setSuggestions(e.target.value)}
        rows={2}
        placeholder={t.suggPh}
        style={taStyle}
      />

      {error && <div style={{ fontSize: 13, color: '#991b1b', marginBottom: 10 }}>⚠ {error}</div>}

      <button onClick={submit} disabled={busy} style={{
        width: '100%', padding: '11px', borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer',
        background: busy ? '#9ca3af' : '#f26a1b', color: '#fff', fontSize: 14, fontWeight: 700,
      }}>
        {busy ? t.uploading : `${t.upload} ${files.length || ''} ${files.length === 1 ? t.file : t.files}`.replace(/\s+/g, ' ').trim()}
      </button>
      <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>{t.autoCompress}</p>
    </div>
  )
}

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#065f46', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', margin: '4px 0' }
const taStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 12, resize: 'vertical', boxSizing: 'border-box' }
