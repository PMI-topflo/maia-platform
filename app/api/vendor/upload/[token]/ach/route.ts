// =====================================================================
// /api/vendor/upload/[token]/ach   (token-gated; no session)
//
// GET  → what ACH we currently have in CINC for the work order's linked
//        vendor, so the vendor can confirm it hasn't changed:
//        { hasVendor, onFile, bankName, routing(full), accountLast4, accountType }.
//        Routing is the public bottom-of-check number → shown in full;
//        the account number is ALWAYS masked to last-4.
// POST → { action:'confirm' }            vendor confirms the on-file ACH is unchanged
//        { action:'update', routing, account, accountType, bankName?,
//          authorizedName, authorizedTitle, certify:true }
//        → generate the signed authorization PDF, file it on the work order
//          (classified 'ach' for the existing staff "→ CINC" push). The full
//          numbers live only inside that PDF; the DB keeps last-4 only.
//
// This is the "fill the form in the system" path. It does NOT write CINC
// directly — staff confirm the bank change on the work order (fraud control).
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyVendorUploadToken } from '@/lib/vendor-upload-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCincVendorDetail } from '@/lib/integrations/cinc'
import { lookupBankName, isValidRoutingNumber } from '@/lib/bank-routing'
import { buildAchAuthorizationPdf } from '@/lib/vendor-ach-authorization'
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

  if (!vendorId) {
    return NextResponse.json({ hasVendor: false, onFile: false, vendorName })
  }
  const detail = await getCincVendorDetail(vendorId).catch(() => null)
  const routing = detail?.Routing ?? null
  const account = detail?.Account ?? null
  const onFile  = !!(routing && account)
  return NextResponse.json({
    hasVendor: true,
    vendorName: detail?.VendorName ?? vendorName,
    onFile,
    bankName:     onFile ? await lookupBankName(routing!) : null,
    routing:      onFile ? routing : null,
    accountLast4: onFile ? last4(account) : null,
    accountType:  detail?.AccountType === 1 ? 'savings' : detail?.AccountType === 0 ? 'checking' : null,
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

  // ── Confirm the on-file ACH is unchanged ──────────────────────────────
  if (action === 'confirm') {
    const acctLast4 = last4(typeof body.accountLast4 === 'string' ? body.accountLast4 : null)
    await appendMessage(ticketId, {
      direction: 'internal_note', channel: 'internal', from_addr: who,
      body: `🏦 Vendor CONFIRMED the bank account on file is unchanged${acctLast4 ? ` (account ••••${acctLast4})` : ''}, re-verified ${today}.`,
    }).catch(() => null)
    return NextResponse.json({ ok: true, confirmed: true })
  }

  // ── Update / provide new ACH banking ──────────────────────────────────
  if (action !== 'update') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  const routing = String(body.routing ?? '').replace(/\D/g, '')
  const account = String(body.account ?? '').replace(/\D/g, '')
  const accountType = body.accountType === 'savings' ? 'savings' : 'checking'
  const authorizedName  = String(body.authorizedName ?? '').trim()
  const authorizedTitle = String(body.authorizedTitle ?? '').trim()
  const certify = body.certify === true

  if (!isValidRoutingNumber(routing)) return NextResponse.json({ error: 'Enter a valid 9-digit routing number.' }, { status: 400 })
  if (account.length < 4 || account.length > 17) return NextResponse.json({ error: 'Enter a valid account number.' }, { status: 400 })
  if (!authorizedName)  return NextResponse.json({ error: 'Your full name is required.' }, { status: 400 })
  if (!authorizedTitle) return NextResponse.json({ error: 'Your title is required.' }, { status: 400 })
  if (!certify) return NextResponse.json({ error: 'You must confirm you are responsible for the information.' }, { status: 400 })

  const bankName = (typeof body.bankName === 'string' && body.bankName.trim()) ? body.bankName.trim() : await lookupBankName(routing)

  const pdf = await buildAchAuthorizationPdf({
    vendorName: vendorName ?? 'Vendor', woLabel, bankName, routing, account, accountType,
    authorizedName, authorizedTitle, date: today, submissionNote: `Authorized by ${authorizedName}, ${authorizedTitle}.`,
  })

  const filename = `ACH Authorization — ${(vendorName ?? 'vendor').slice(0, 40)} — ${today}.pdf`.replace(/[/\\]/g, '-')
  const saved = await saveWorkOrderFile({
    ticketId, source: 'staff_upload', bytes: pdf, filename,
    contentType: 'application/pdf', uploadedByEmail: `vendor-portal:${vendorName ?? 'vendor'}`,
  })
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 502 })

  // Classify as ACH so the existing staff "→ CINC" push works. Store MASKED
  // values + the authorization record only — full numbers stay in the PDF.
  await supabaseAdmin.from('work_order_attachments').update({
    extracted_doc_type: 'ach',
    extracted_data: {
      confidence: 1,
      summary: `Vendor-submitted ACH authorization (${accountType}) — ${bankName ?? 'bank from routing'}`,
      fields: {
        bank_name:        bankName ?? null,
        routing_last4:    routing.slice(-4),
        account_last4:    account.slice(-4),
        account_type:     accountType,
        authorized_name:  authorizedName,
        authorized_title: authorizedTitle,
        authorized_at:    new Date().toISOString(),
      },
    },
    extracted_at: new Date().toISOString(),
  }).eq('id', saved.id).then(() => null, () => null)

  await appendMessage(ticketId, {
    direction: 'internal_note', channel: 'internal', from_addr: who,
    body: `🏦 Vendor submitted ACH banking via the portal — ${bankName ?? 'bank'} · ${accountType} · account ••••${account.slice(-4)}. `
      + `Authorized by ${authorizedName} (${authorizedTitle}). A signed authorization PDF is filed on this work order — review it and use "→ CINC" to apply it to the vendor record.`,
  }).catch(() => null)

  if (ticket.assignee_email) {
    await sendEmail({
      to: ticket.assignee_email,
      subject: `Vendor submitted ACH banking — ${ticket.ticket_number}`,
      html: `<p><strong>${vendorName ?? 'A vendor'}</strong> submitted direct-deposit (ACH) banking for <strong>${ticket.ticket_number}</strong> via the portal, authorized by ${authorizedName} (${authorizedTitle}).</p>
             <p>A signed authorization PDF is filed on the work order. Review it and click <strong>→ CINC</strong> to apply it to the vendor record.</p>
             <p><a href="${APP}/admin/tickets/${ticketId}">Open the work order →</a></p>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true, updated: true })
}
