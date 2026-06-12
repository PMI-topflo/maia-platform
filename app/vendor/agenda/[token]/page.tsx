// =====================================================================
// /vendor/agenda/[token] — vendor office confirms next week's agenda.
// Public, token-gated, localized to the service's office language.
// =====================================================================

import { verifyAgendaToken } from '@/lib/agenda-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { nextMonday } from '@/lib/recurring-agenda'
import { LANGUAGES } from '@/lib/recurring-services'
import AgendaForm from './AgendaForm'
import VendorLangBar from '@/components/VendorLangBar'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Confirm agenda — PMI Top Florida' }

interface Props { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }

const T = {
  en: { wo: 'Service', expired: 'This link is invalid or has expired. Please ask PMI for a new one.', notFound: 'Service not found.' },
  es: { wo: 'Servicio', expired: 'Este enlace no es válido o ha expirado. Pida a PMI uno nuevo.', notFound: 'Servicio no encontrado.' },
  pt: { wo: 'Serviço', expired: 'Este link é inválido ou expirou. Peça um novo à PMI.', notFound: 'Serviço não encontrado.' },
  fr: { wo: 'Service', expired: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau à PMI.', notFound: 'Service introuvable.' },
  he: { wo: 'שירות', expired: 'קישור זה אינו תקף או שפג תוקפו. בקשו מ-PMI קישור חדש.', notFound: 'השירות לא נמצא.' },
  ru: { wo: 'Сервис', expired: 'Эта ссылка недействительна или истекла. Запросите новую у PMI.', notFound: 'Сервис не найден.' },
  ht: { wo: 'Sèvis', expired: 'Lyen sa a pa valab oswa li ekspire. Tanpri mande PMI yon nouvo.', notFound: 'Sèvis la pa jwenn.' },
} as const

export default async function AgendaPage({ params, searchParams }: Props) {
  const { token } = await params
  const serviceId = await verifyAgendaToken(token)
  if (!serviceId) return <Shell><Bad>{T.en.expired} / {T.es.expired}</Bad></Shell>

  const { data: svc } = await supabaseAdmin.from('recurring_services').select('*').eq('id', serviceId).maybeSingle()
  if (!svc) return <Shell><Bad>{T.en.notFound}</Bad></Shell>

  const norm = (l: string | undefined) => (l && ['es', 'pt', 'fr', 'he', 'ru', 'ht'].includes(l) ? l : 'en') as keyof typeof T
  // Stored default for this service; a ?lang= override lets the office preview
  // (and then save) another language without changing the record first.
  const defaultLang = norm(svc.office_language)
  const lang = norm((await searchParams)?.lang ?? svc.office_language)

  // Crew for this vendor (by CINC id when present, else by name).
  let q = supabaseAdmin.from('vendor_employees').select('id, name, preferred_channel, preferred_language').eq('active', true)
  q = svc.cinc_vendor_id ? q.eq('cinc_vendor_id', svc.cinc_vendor_id) : q.eq('vendor_name', svc.vendor_name)
  const { data: crew } = await q
  const weekOf = nextMonday()

  return (
    <Shell dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <VendorLangBar current={lang} defaultLang={defaultLang} langs={[...LANGUAGES]} saveEndpoint={`/api/vendor/agenda/${encodeURIComponent(token)}/office-language`} />
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{T[lang].wo}</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '6px 0 2px' }}>{svc.service_type} — {svc.association_code}</h1>
      <div style={{ fontSize: 13, color: '#4b5563' }}>{svc.vendor_name}</div>
      <AgendaForm token={token} lang={lang} weekOf={weekOf} crew={(crew ?? []).map(c => ({ id: c.id as string, name: c.name as string }))} />
    </Shell>
  )
}

function Shell({ children, dir = 'ltr' }: { children: React.ReactNode; dir?: 'ltr' | 'rtl' }) {
  return (
    <div dir={dir} style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f26a1b', marginBottom: 14 }}>PMI Top Florida Properties</div>
        {children}
      </div>
    </div>
  )
}
function Bad({ children }: { children: React.ReactNode }) { return <p style={{ fontSize: 14, color: '#991b1b' }}>{children}</p> }
