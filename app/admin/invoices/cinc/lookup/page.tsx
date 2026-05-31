// =====================================================================
// app/admin/invoices/cinc/lookup/page.tsx
//
// Resolver hop for the reconciliation "Invoice #" links. CINC bank
// transactions only carry the invoice NUMBER (free text), but the
// invoice-detail page is keyed by the numeric CINC InvoiceID. This page
// takes ?assoc=&number=&date=, resolves the InvoiceID via CINC's invoice
// search, and redirects to /admin/invoices/cinc/<id>. Falls back to a
// friendly message when there's no match. Staff-gated by middleware.
// =====================================================================

import { redirect } from 'next/navigation'
import { findInvoiceIdByNumber } from '@/lib/integrations/cinc'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../../components/AdminNav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Open invoice — PMI Top Florida' }

interface Props {
  searchParams: Promise<{ number?: string; assoc?: string; date?: string; embed?: string }>
}

export default async function InvoiceLookupPage({ searchParams }: Props) {
  const sp     = await searchParams
  const number = typeof sp.number === 'string' ? sp.number.trim() : ''
  const assoc  = typeof sp.assoc === 'string' ? sp.assoc : undefined
  const date   = typeof sp.date === 'string' ? sp.date : undefined
  const embed  = sp.embed === '1'

  let invoiceId: number | null = null
  if (number) {
    invoiceId = await findInvoiceIdByNumber({ invoiceNumber: number, assocCode: assoc, aroundDate: date })
    // Carry the embed flag through so the detail page stays chrome-less
    // inside the modal iframe.
    if (invoiceId) redirect(`/admin/invoices/cinc/${invoiceId}${embed ? '?embed=1' : ''}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {!embed && (
        <SiteHeader subtitle="INVOICE LOOKUP">
          <AdminNav />
        </SiteHeader>
      )}
      <div style={{ maxWidth: 560, margin: '48px auto', padding: 24, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Invoice not found in CINC</h1>
        <p style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>
          {number
            ? <>No CINC invoice matched <strong>#{number}</strong>{assoc ? <> for <strong>{assoc}</strong></> : null}. It may be older than the ~11-month search window, voided, or entered under a different number.</>
            : 'No invoice number was provided.'}
        </p>
        <p style={{ marginTop: 16 }}>
          <a href="/admin/reconciliation" style={{ color: '#2563eb', textDecoration: 'underline', fontSize: 13 }}>← Back to reconciliation</a>
        </p>
      </div>
    </div>
  )
}
