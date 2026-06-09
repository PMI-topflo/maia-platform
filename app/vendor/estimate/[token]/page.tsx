// =====================================================================
// /vendor/estimate/[token]  — login-free vendor RFQ page.
// Token → estimate_request_vendors row → shows the work order scope +
// photos, lets the vendor accept-to-quote (+ respond-by date) and upload
// their estimate. Public route (not in middleware matcher).
// =====================================================================

import { verifyEstimateRequestToken } from '@/lib/estimate-request-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import EstimateResponder from './EstimateResponder'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Estimate request — PMI Top Florida Properties' }

export default async function EstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const erVendorId = await verifyEstimateRequestToken(token)

  const shell = (msg: string) => (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: 24, fontFamily: 'Helvetica,Arial,sans-serif' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, color: '#374151' }}>{msg}</div>
    </div>
  )
  if (!erVendorId) return shell('This estimate-request link is invalid or has expired. Please contact PMI Top Florida Properties.')

  const { data: erv } = await supabaseAdmin.from('estimate_request_vendors')
    .select('id, request_id, vendor_name, status, respond_by').eq('id', erVendorId).single()
  if (!erv) return shell('This request could not be found.')
  const { data: reqRow } = await supabaseAdmin.from('estimate_requests')
    .select('ticket_id, association_code, scope, photo_paths').eq('id', erv.request_id).single()
  if (!reqRow) return shell('This request could not be found.')
  const { data: ticket } = await supabaseAdmin.from('tickets').select('ticket_number, subject').eq('id', reqRow.ticket_id).single()

  const paths = Array.isArray(reqRow.photo_paths) ? (reqRow.photo_paths as string[]) : []
  let photoUrls: string[] = []
  if (paths.length) {
    const { data: signed } = await supabaseAdmin.storage.from('work-order-photos').createSignedUrls(paths, 3600)
    photoUrls = (signed ?? []).map(s => s.signedUrl).filter(Boolean)
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px', fontFamily: 'Helvetica,Arial,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Maia <span style={{ color: '#e85d26' }}>&#10022;</span></div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>by PMI Top Florida Properties</div>
      </div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>Estimate request</h1>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
          {ticket?.ticket_number ?? ''}{reqRow.association_code ? ` · ${reqRow.association_code}` : ''}{ticket?.subject ? ` — ${ticket.subject}` : ''}
        </div>
        <EstimateResponder
          token={token}
          vendorName={erv.vendor_name}
          scope={reqRow.scope}
          photos={photoUrls}
          initialStatus={erv.status}
          respondBy={erv.respond_by}
        />
      </div>
    </div>
  )
}
