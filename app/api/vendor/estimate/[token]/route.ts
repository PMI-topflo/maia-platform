// =====================================================================
// POST /api/vendor/estimate/[token]
// The vendor's RFQ actions (token-gated, no session):
//   JSON  { action:'accept', respond_by }  → accept to quote + commit a date
//   JSON  { action:'decline' }             → decline
//   multipart (file)                       → upload the estimate onto the WO
// Notifies Paola on accept + on estimate received.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyEstimateRequestToken } from '@/lib/estimate-request-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveWorkOrderFile } from '@/lib/work-order-attachments'
import { extractVendorDocument } from '@/lib/vendor-doc-extraction'
import { appendMessage } from '@/lib/tickets'
import { sendEmail } from '@/lib/gmail'

const toNum = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PAOLA = 'service@topfloridaproperties.com'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i
const dateOrNull = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null

async function loadContext(erVendorId: string) {
  const { data: erv } = await supabaseAdmin.from('estimate_request_vendors')
    .select('id, request_id, vendor_name, vendor_email, status').eq('id', erVendorId).single()
  if (!erv) return null
  const { data: reqRow } = await supabaseAdmin.from('estimate_requests').select('ticket_id, association_code, scope').eq('id', erv.request_id).single()
  const { data: ticket } = reqRow ? await supabaseAdmin.from('tickets').select('id, ticket_number').eq('id', reqRow.ticket_id).single() : { data: null }
  return { erv, reqRow, ticket }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const erVendorId = await verifyEstimateRequestToken(token)
  if (!erVendorId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  const cx = await loadContext(erVendorId)
  if (!cx) return NextResponse.json({ error: 'request not found' }, { status: 404 })
  const { erv, reqRow, ticket } = cx
  const woLabel = ticket?.ticket_number ?? `WO ${reqRow?.ticket_id ?? ''}`
  const vname = erv.vendor_name ?? erv.vendor_email

  const ctype = req.headers.get('content-type') ?? ''

  // ── Estimate upload (multipart) ─────────────────────────────────────
  if (ctype.includes('multipart/form-data')) {
    if (!reqRow?.ticket_id) return NextResponse.json({ error: 'work order missing' }, { status: 400 })
    let form: FormData
    try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
    const file = form.getAll('files').find((f): f is File => f instanceof File && f.size > 0)
    if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 })
    if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'file type not allowed' }, { status: 400 })
    const buf = Buffer.from(await file.arrayBuffer())
    // Read the estimate's dollar amount (best-quality bytes) for the comparison.
    const extraction = await extractVendorDocument(buf, file.name, file.type || null).catch(() => null)
    const amount = extraction ? toNum(extraction.fields.amount) : null
    const summary = extraction?.summary ?? null

    const r = await saveWorkOrderFile({ ticketId: reqRow.ticket_id, source: 'staff_upload', bytes: buf, filename: file.name, contentType: file.type || null, uploadedByEmail: `vendor-estimate:${vname}` })
    if (!r.ok) return NextResponse.json({ error: (r as { error: string }).error }, { status: 500 })
    await supabaseAdmin.from('estimate_request_vendors').update({ status: 'submitted', submitted_at: new Date().toISOString(), estimate_path: r.id, extracted_amount: amount, estimate_summary: summary }).eq('id', erv.id)
    await appendMessage(reqRow.ticket_id, { direction: 'internal_note', channel: 'internal', from_addr: `Vendor (${vname})`, body: `💲 ${vname} submitted an estimate (${file.name}) via the request link.` }).catch(() => null)
    await sendEmail({ to: PAOLA, subject: `Estimate received — ${woLabel} — ${vname}`, html: `<p><strong>${vname}</strong> uploaded an estimate for <strong>${woLabel}</strong>.</p><p><a href="${APP}/admin/tickets/${reqRow.ticket_id}">Open the work order →</a></p>` }).catch(() => null)
    return NextResponse.json({ ok: true, status: 'submitted' })
  }

  // ── Accept / decline (JSON) ─────────────────────────────────────────
  let body: { action?: string; respond_by?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  if (body.action === 'decline') {
    await supabaseAdmin.from('estimate_request_vendors').update({ status: 'declined' }).eq('id', erv.id)
    await appendMessage(reqRow?.ticket_id ?? 0, { direction: 'internal_note', channel: 'internal', from_addr: `Vendor (${vname})`, body: `🚫 ${vname} declined to quote ${woLabel}.` }).catch(() => null)
    return NextResponse.json({ ok: true, status: 'declined' })
  }
  if (body.action === 'accept') {
    const respondBy = dateOrNull(body.respond_by)
    await supabaseAdmin.from('estimate_request_vendors').update({ status: 'accepted', accepted_at: new Date().toISOString(), respond_by: respondBy }).eq('id', erv.id)
    await appendMessage(reqRow?.ticket_id ?? 0, { direction: 'internal_note', channel: 'internal', from_addr: `Vendor (${vname})`, body: `✅ ${vname} accepted to quote ${woLabel}${respondBy ? `, responding by ${respondBy}` : ''}.` }).catch(() => null)
    await sendEmail({ to: PAOLA, subject: `Vendor accepted to quote — ${woLabel} — ${vname}`, html: `<p><strong>${vname}</strong> accepted to quote <strong>${woLabel}</strong>${respondBy ? ` and will respond by <strong>${respondBy}</strong>` : ''}.</p>` }).catch(() => null)
    return NextResponse.json({ ok: true, status: 'accepted' })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
