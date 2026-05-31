// =====================================================================
// /vendor/upload/[token] — login-free vendor upload portal
//
// A vendor opens the link staff emailed them and uploads Estimate /
// Invoice / Photos straight onto one work order. Token-gated (no account);
// shows minimal WO context only. Public route (not in middleware matcher).
// =====================================================================

import { verifyVendorUploadToken } from '@/lib/vendor-upload-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import Uploader from './Uploader'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Upload to PMI Top Florida' }

interface Props { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }

const T = {
  en: { wo: 'Work order', fallbackTitle: 'Upload your files', vendor: 'Vendor', intro: 'Upload your <b>estimate</b>, <b>invoice</b>, or <b>job photos</b> for this work order. PDF, JPG, PNG accepted.', expired: 'This upload link is invalid or has expired. Please ask PMI for a new link.', notFound: 'This work order could not be found.' },
  es: { wo: 'Orden de trabajo', fallbackTitle: 'Suba sus archivos', vendor: 'Proveedor', intro: 'Suba su <b>estimado</b>, <b>factura</b> o <b>fotos del trabajo</b> para esta orden. Se aceptan PDF, JPG, PNG.', expired: 'Este enlace no es válido o ha expirado. Pida a PMI un nuevo enlace.', notFound: 'No se encontró esta orden de trabajo.' },
} as const

export default async function VendorUploadPage({ params, searchParams }: Props) {
  const { token } = await params
  const lang = (((await searchParams)?.lang) === 'es' ? 'es' : 'en') as keyof typeof T
  const t = T[lang]
  const ticketId = await verifyVendorUploadToken(token)

  if (!ticketId) return <Shell><Bad>{t.expired}</Bad></Shell>

  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, subject, association_code, status')
    .eq('id', ticketId)
    .single()
  if (!ticket) return <Shell><Bad>{t.notFound}</Bad></Shell>

  const { data: wod } = await supabaseAdmin
    .from('work_order_details')
    .select('vendor_name, work_location_name, address_line1, city, state')
    .eq('ticket_id', ticketId)
    .maybeSingle()

  const where = [wod?.work_location_name, wod?.address_line1, [wod?.city, wod?.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')

  return (
    <Shell>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.wo} {ticket.ticket_number}</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '6px 0 2px' }}>{ticket.subject || t.fallbackTitle}</h1>
      {where && <div style={{ fontSize: 13, color: '#4b5563' }}>{where}</div>}
      {wod?.vendor_name && <div style={{ fontSize: 13, color: '#4b5563', marginTop: 2 }}>{t.vendor}: {wod.vendor_name}</div>}
      <p style={{ fontSize: 13, color: '#4b5563', margin: '14px 0 18px', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: t.intro }} />
      <Uploader token={token} lang={lang} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f26a1b', marginBottom: 14 }}>PMI Top Florida Properties</div>
        {children}
      </div>
    </div>
  )
}
function Bad({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14, color: '#991b1b' }}>{children}</p>
}
