// =====================================================================
// /api/vendor/upload/[token]/w9   (token-gated; no session)
//
// GET  → what tax info we currently have in CINC for the work order's linked
//        vendor, so the vendor can confirm it hasn't changed:
//        { hasVendor, onFile, checkName, taxIdLast4 }. The TIN is ALWAYS
//        masked to last-4.
// POST → { action:'confirm' }   vendor confirms the on-file tax ID is unchanged
//        { action:'update', legalName, businessName?, classification, tinType,
//          tin, authorizedName, authorizedTitle, certify:true }
//        → generate a Substitute W-9 PDF, file it on the work order
//          (classified 'w9' for the existing staff "→ CINC" push). The full
//          TIN lives only inside that PDF; the DB keeps last-4 only.
//
// Mirrors the ACH self-service route. Staff confirm the CINC write on the
// work order via the existing "→ CINC" action.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyVendorUploadToken } from '@/lib/vendor-upload-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCincVendorDetail } from '@/lib/integrations/cinc'
import { buildW9RecordPdf, TAX_CLASSIFICATION_LABELS, type TaxClassification } from '@/lib/vendor-w9-record'
import { saveWorkOrderFile } from '@/lib/work-order-attachments'
import { appendMessage } from '@/lib/tickets'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const last4 = (s: string | null | undefined) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : null }

async function context(ticketId: number) {
  const { data: ticket } = await supabaseAdmin.from('tickets')
    .select('id, ticket_number, association_code, assignee_email').eq('id', ticketId).single()
  const { data: wod } = await supabaseAdmin.from('work_order_details')
    .select('cinc_vendor_id, vendor_name').eq('ticket_id', ticketId).maybeSingle()
  return {
    ticket,
    vendorId: wod?.cinc_vendor_id != null ? Number(wod.cinc_vendor_id) : null,
    vendorName: (wod?.vendor_name as string | null) ?? null,
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const ticketId = await verifyVendorUploadToken(token)
  if (!ticketId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  const { ticket, vendorId, vendorName } = await context(ticketId)
  if (!ticket) return NextResponse.json({ error: 'work order not found' }, { status: 404 })

  if (!vendorId) return NextResponse.json({ hasVendor: false, onFile: false, vendorName })

  const detail = await getCincVendorDetail(vendorId).catch(() => null)
  const taxId = detail?.TaxID ?? null
  const onFile = !!(taxId && String(taxId).trim())
  return NextResponse.json({
    hasVendor: true,
    vendorName: detail?.VendorName ?? vendorName,
    onFile,
    checkName:  detail?.CheckName ?? null,
    taxIdLast4: onFile ? last4(taxId) : null,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const ticketId = await verifyVendorUploadToken(token)
  if (!ticketId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const action = String(body.action ?? '')

  const { ticket, vendorName } = await context(ticketId)
  if (!ticket) return NextResponse.json({ error: 'work order not found' }, { status: 404 })
  const woLabel = `${ticket.ticket_number}${ticket.association_code ? ` · ${ticket.association_code}` : ''}`
  const who = vendorName ? `Vendor (${vendorName})` : 'Vendor'
  const today = new Date().toISOString().slice(0, 10)

  if (action === 'confirm') {
    const tail = last4(typeof body.taxIdLast4 === 'string' ? body.taxIdLast4 : null)
    await appendMessage(ticketId, {
      direction: 'internal_note', channel: 'internal', from_addr: who,
      body: `🧾 Vendor CONFIRMED the tax ID on file is unchanged${tail ? ` (TIN ••••${tail})` : ''}, re-verified ${today}.`,
    }).catch(() => null)
    return NextResponse.json({ ok: true, confirmed: true })
  }

  if (action !== 'update') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  const legalName     = String(body.legalName ?? '').trim()
  const businessName  = String(body.businessName ?? '').trim() || null
  const classification = String(body.classification ?? '') as TaxClassification
  const tinType       = body.tinType === 'ssn' ? 'ssn' : 'ein'
  const tin           = String(body.tin ?? '').replace(/\D/g, '')
  const authorizedName  = String(body.authorizedName ?? '').trim()
  const authorizedTitle = String(body.authorizedTitle ?? '').trim()
  const certify = body.certify === true

  if (!legalName) return NextResponse.json({ error: 'Your legal name is required.' }, { status: 400 })
  if (!(classification in TAX_CLASSIFICATION_LABELS)) return NextResponse.json({ error: 'Select a federal tax classification.' }, { status: 400 })
  if (tin.length !== 9) return NextResponse.json({ error: `Enter a valid 9-digit ${tinType === 'ssn' ? 'SSN' : 'EIN'}.` }, { status: 400 })
  if (!authorizedName)  return NextResponse.json({ error: 'Your full name is required.' }, { status: 400 })
  if (!authorizedTitle) return NextResponse.json({ error: 'Your title is required.' }, { status: 400 })
  if (!certify) return NextResponse.json({ error: 'You must certify the information under penalties of perjury.' }, { status: 400 })

  const pdf = await buildW9RecordPdf({
    vendorName: vendorName ?? 'Vendor', woLabel, legalName, businessName, classification,
    tinType, tin, authorizedName, authorizedTitle, date: today,
  })

  const filename = `Substitute W-9 — ${(legalName || vendorName || 'vendor').slice(0, 40)} — ${today}.pdf`.replace(/[/\\]/g, '-')
  const saved = await saveWorkOrderFile({
    ticketId, source: 'staff_upload', bytes: pdf, filename,
    contentType: 'application/pdf', uploadedByEmail: `vendor-portal:${vendorName ?? 'vendor'}`,
  })
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 502 })

  // Classify as W-9 so the existing staff "→ CINC" push (TaxID + CheckName)
  // works. Store MASKED values + the authorization record only — the full TIN
  // stays inside the PDF.
  await supabaseAdmin.from('work_order_attachments').update({
    extracted_doc_type: 'w9',
    extracted_data: {
      confidence: 1,
      summary: `Vendor-submitted Substitute W-9 — ${legalName} (${TAX_CLASSIFICATION_LABELS[classification]})`,
      fields: {
        legal_name:       legalName,
        business_name:    businessName,
        classification,
        tin_type:         tinType,
        tin_last4:        tin.slice(-4),
        authorized_name:  authorizedName,
        authorized_title: authorizedTitle,
        authorized_at:    new Date().toISOString(),
      },
    },
    extracted_at: new Date().toISOString(),
  }).eq('id', saved.id).then(() => null, () => null)

  await appendMessage(ticketId, {
    direction: 'internal_note', channel: 'internal', from_addr: who,
    body: `🧾 Vendor submitted a Substitute W-9 via the portal — ${legalName} · ${TAX_CLASSIFICATION_LABELS[classification]} · ${tinType.toUpperCase()} ••••${tin.slice(-4)}. `
      + `Certified by ${authorizedName} (${authorizedTitle}). The W-9 PDF is filed on this work order — review it and use "→ CINC" to apply the tax ID to the vendor record.`,
  }).catch(() => null)

  if (ticket.assignee_email) {
    await sendEmail({
      to: ticket.assignee_email,
      subject: `Vendor submitted a W-9 — ${ticket.ticket_number}`,
      html: `<p><strong>${vendorName ?? 'A vendor'}</strong> submitted a Substitute W-9 (tax ID) for <strong>${ticket.ticket_number}</strong> via the portal, certified by ${authorizedName} (${authorizedTitle}).</p>
             <p>The W-9 PDF is filed on the work order. Review it and click <strong>→ CINC</strong> to apply the tax ID to the vendor record.</p>
             <p><a href="${APP}/admin/tickets/${ticketId}">Open the work order →</a></p>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true, updated: true })
}
