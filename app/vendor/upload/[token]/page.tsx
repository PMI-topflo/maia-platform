// =====================================================================
// /vendor/upload/[token] — login-free vendor upload portal
//
// A vendor opens the link staff emailed them and uploads Estimate /
// Invoice / Photos straight onto one work order. Token-gated (no account);
// shows minimal WO context only. Public route (not in middleware matcher).
// =====================================================================

import { verifyVendorUploadToken } from '@/lib/vendor-upload-token'
import { verifyCrewToken } from '@/lib/crew-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { LANGUAGES } from '@/lib/recurring-services'
import Uploader from './Uploader'
import VendorLangBar from '@/components/VendorLangBar'
import PortalFormHeader from '@/components/PortalFormHeader'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Upload to PMI Top Florida' }

interface Props { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string; e?: string; need?: string }> }

const T = {
  en: { wo: 'Work order', fallbackTitle: 'Upload your files', vendor: 'Vendor', intro: 'Upload your <b>estimate</b>, <b>invoice</b>, or <b>job photos</b> for this work order. PDF, JPG, PNG accepted.', expired: 'This upload link is invalid or has expired. Please ask PMI for a new link.', notFound: 'This work order could not be found.' },
  es: { wo: 'Orden de trabajo', fallbackTitle: 'Suba sus archivos', vendor: 'Proveedor', intro: 'Suba su <b>estimado</b>, <b>factura</b> o <b>fotos del trabajo</b> para esta orden. Se aceptan PDF, JPG, PNG.', expired: 'Este enlace no es válido o ha expirado. Pida a PMI un nuevo enlace.', notFound: 'No se encontró esta orden de trabajo.' },
  pt: { wo: 'Ordem de serviço', fallbackTitle: 'Envie seus arquivos', vendor: 'Fornecedor', intro: 'Envie seu <b>orçamento</b>, <b>fatura</b> ou <b>fotos do trabalho</b> para esta ordem. Aceitamos PDF, JPG, PNG.', expired: 'Este link de envio é inválido ou expirou. Peça um novo à PMI.', notFound: 'Não foi possível encontrar esta ordem de serviço.' },
  fr: { wo: 'Bon de travail', fallbackTitle: 'Téléversez vos fichiers', vendor: 'Prestataire', intro: 'Téléversez votre <b>devis</b>, <b>facture</b> ou <b>photos du travail</b> pour ce bon de travail. PDF, JPG, PNG acceptés.', expired: 'Ce lien de téléversement est invalide ou a expiré. Demandez-en un nouveau à PMI.', notFound: 'Ce bon de travail est introuvable.' },
  he: { wo: 'הזמנת עבודה', fallbackTitle: 'העלו את הקבצים שלכם', vendor: 'ספק', intro: 'העלו את <b>הצעת המחיר</b>, <b>החשבונית</b> או <b>תמונות העבודה</b> עבור הזמנת עבודה זו. ניתן להעלות PDF, JPG, PNG.', expired: 'קישור ההעלאה אינו תקף או שפג תוקפו. בקשו מ-PMI קישור חדש.', notFound: 'לא ניתן למצוא את הזמנת העבודה.' },
  ru: { wo: 'Заказ-наряд', fallbackTitle: 'Загрузите файлы', vendor: 'Подрядчик', intro: 'Загрузите <b>смету</b>, <b>счёт</b> или <b>фото работ</b> для этого заказа-наряда. Принимаются PDF, JPG, PNG.', expired: 'Эта ссылка для загрузки недействительна или истекла. Запросите новую у PMI.', notFound: 'Этот заказ-наряд не найден.' },
  ht: { wo: 'Lòd travay', fallbackTitle: 'Voye fichye ou yo', vendor: 'Founisè', intro: 'Voye <b>estimasyon</b>, <b>fakti</b>, oswa <b>foto travay</b> ou pou lòd travay sa a. Nou aksepte PDF, JPG, PNG.', expired: 'Lyen sa a pa valab oswa li ekspire. Tanpri mande PMI yon nouvo lyen.', notFound: 'Nou pa jwenn lòd travay sa a.' },
} as const

export default async function VendorUploadPage({ params, searchParams }: Props) {
  const { token } = await params
  const sp = await searchParams
  const rawLang = sp?.lang ?? 'en'
  const lang = (['es', 'pt', 'fr', 'he', 'ru', 'ht'].includes(rawLang) ? rawLang : 'en') as keyof typeof T
  const t = T[lang]
  const dir = lang === 'he' ? 'rtl' : 'ltr'

  // Per-employee token (?e=) — identifies the crew member so they can save
  // the chosen language as their default for future messages.
  const eTok = sp?.e
  let defaultLang: string | null = null
  if (eTok) {
    const employeeId = await verifyCrewToken(eTok)
    if (employeeId) {
      const { data: emp } = await supabaseAdmin.from('vendor_employees').select('preferred_language').eq('id', employeeId).maybeSingle()
      defaultLang = emp?.preferred_language ?? null
    }
  }
  const langBar = (
    <VendorLangBar
      current={lang}
      defaultLang={defaultLang}
      langs={[...LANGUAGES]}
      saveEndpoint={eTok ? `/api/vendor/crew/${encodeURIComponent(eTok)}/language` : null}
    />
  )

  const ticketId = await verifyVendorUploadToken(token)

  if (!ticketId) return <Shell dir={dir}><Bad>{t.expired}</Bad></Shell>

  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, subject, association_code, status')
    .eq('id', ticketId)
    .single()
  if (!ticket) return <Shell dir={dir}><Bad>{t.notFound}</Bad></Shell>

  const { data: wod } = await supabaseAdmin
    .from('work_order_details')
    .select('vendor_name, work_location_name, address_line1, city, state')
    .eq('ticket_id', ticketId)
    .maybeSingle()

  const where = [wod?.work_location_name, wod?.address_line1, [wod?.city, wod?.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')

  // Association name + property address — the crew needs to know WHICH site
  // this work order is for. work_order_details location (`where` above) is
  // often empty for recurring visits, and the code alone ("WBPA") means
  // nothing to a vendor, so surface the real name + address (principal_address
  // is the manually-entered PROPERTY address, not the Sunbiz/agent one).
  const { data: assocRow } = ticket.association_code
    ? await supabaseAdmin
        .from('associations')
        .select('association_name, principal_address, city, state, zip')
        .eq('association_code', ticket.association_code)
        .maybeSingle()
    : { data: null }
  const assocName = ((assocRow?.association_name as string | null) ?? '').trim() || (ticket.association_code as string | null) || ''
  const aa = (assocRow ?? {}) as { principal_address?: string | null; city?: string | null; state?: string | null; zip?: string | null }
  const assocAddr = [
    aa.principal_address?.trim(),
    [aa.city?.trim(), [aa.state?.trim(), aa.zip?.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  ].filter(Boolean).join(', ')

  return (
    <Shell dir={dir}>
      {langBar}
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.wo} {ticket.ticket_number}</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '6px 0 2px' }}>{ticket.subject || t.fallbackTitle}</h1>
      {assocName && <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginTop: 2 }}>{assocName}</div>}
      {assocAddr && <div style={{ fontSize: 13, color: '#4b5563', marginTop: 1 }}>📍 {assocAddr}</div>}
      {where && <div style={{ fontSize: 13, color: '#4b5563' }}>{where}</div>}
      {wod?.vendor_name && <div style={{ fontSize: 13, color: '#4b5563', marginTop: 2 }}>{t.vendor}: {wod.vendor_name}</div>}
      <p style={{ fontSize: 13, color: '#4b5563', margin: '14px 0 18px', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: t.intro }} />
      <Uploader token={token} lang={lang} need={(sp?.need ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)} />
    </Shell>
  )
}

function Shell({ children, dir = 'ltr' }: { children: React.ReactNode; dir?: 'ltr' | 'rtl' }) {
  return (
    <div dir={dir} style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <PortalFormHeader />
        {children}
      </div>
    </div>
  )
}
function Bad({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14, color: '#991b1b' }}>{children}</p>
}
