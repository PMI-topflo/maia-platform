// =====================================================================
// POST /api/vendor/upload/[token]  (multipart: category + files[])
//
// The vendor upload portal's submit endpoint. Token-gated (no session).
// Routes each file by category:
//   invoice          → invoice-intake draft (pre-tagged assoc+vendor+WO)
//   estimate / photos → work-order attachment
// Then logs an internal note on the ticket, nudges status, notifies the
// assignee. Public route (not in middleware matcher).
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyVendorUploadToken } from '@/lib/vendor-upload-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveWorkOrderFile } from '@/lib/work-order-attachments'
import { extractVendorDocument, vendorDocTypeLabel } from '@/lib/vendor-doc-extraction'
import { createInvoiceDraftFromUpload } from '@/lib/invoice-intake'
import { appendMessage, updateTicket } from '@/lib/tickets'
import { sendEmail } from '@/lib/gmail'
import { translateToEnglish } from '@/lib/translate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FILES = 12
const MAX_BYTES = 25 * 1024 * 1024   // 25 MB per file
const ALLOWED   = /\.(pdf|jpe?g|png|heic|webp)$/i

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const ticketId = await verifyVendorUploadToken(token)
  if (!ticketId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }

  const category    = String(form.get('category') ?? 'estimate').toLowerCase()
  const report      = String(form.get('report') ?? '').trim().slice(0, 4000)
  const suggestions = String(form.get('suggestions') ?? '').trim().slice(0, 4000)
  const lang        = String(form.get('lang') ?? 'en').toLowerCase()
  const files       = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0)        return NextResponse.json({ error: 'no files' }, { status: 400 })
  if (files.length > MAX_FILES)  return NextResponse.json({ error: `max ${MAX_FILES} files at once` }, { status: 400 })

  // Work-order context for tagging + notification.
  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, status, association_code, assignee_email, cinc_workorder_id')
    .eq('id', ticketId)
    .single()
  if (!ticket) return NextResponse.json({ error: 'work order not found' }, { status: 404 })

  const { data: wod } = await supabaseAdmin
    .from('work_order_details').select('vendor_name').eq('ticket_id', ticketId).maybeSingle()
  const woNumber = ticket.cinc_workorder_id ? parseInt(String(ticket.cinc_workorder_id), 10) : null

  const saved: string[] = []
  const failed: string[] = []
  const detected: string[] = []   // AI-classified doc types, for the staff note
  for (const file of files) {
    if (!ALLOWED.test(file.name)) { failed.push(`${file.name} (type not allowed)`); continue }
    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) { failed.push(`${file.name} (over 25 MB)`); continue }

    try {
      if (category === 'invoice') {
        const r = await createInvoiceDraftFromUpload({
          ticketId, associationCode: ticket.association_code, vendorName: wod?.vendor_name ?? null,
          workOrderNumber: Number.isFinite(woNumber) ? woNumber : null, buf, filename: file.name,
        })
        r.ok ? saved.push(file.name) : failed.push(file.name)
      } else {
        // Read the document with Claude FIRST, on the original (best-quality)
        // bytes — before saveWorkOrderFile compresses it. Skip pure job-photo
        // batches. Never let a slow/failed extraction block the upload.
        const extraction = category === 'photos'
          ? null
          : await extractVendorDocument(buf, file.name, file.type || null).catch(() => null)

        const r = await saveWorkOrderFile({
          ticketId, source: 'staff_upload', bytes: buf, filename: file.name,
          contentType: file.type || null, uploadedByEmail: `vendor-portal:${wod?.vendor_name ?? 'vendor'}`,
        })
        if (r.ok) {
          saved.push(file.name)
          if (extraction && extraction.confidence >= 0.3 && extraction.docType !== 'other') {
            await supabaseAdmin.from('work_order_attachments').update({
              extracted_doc_type: extraction.docType,
              extracted_data:     { confidence: extraction.confidence, summary: extraction.summary, fields: extraction.fields },
              extracted_at:       new Date().toISOString(),
            }).eq('id', r.id).then(() => null, () => null)
            const exp = extraction.fields.expiration_date
            detected.push(`${vendorDocTypeLabel(extraction.docType)}${exp ? ` (exp ${exp})` : ''} — ${file.name}`)
          }
        } else {
          failed.push(`${file.name} (${(r as { error: string }).error})`)
        }
      }
    } catch (e) {
      failed.push(`${file.name} (${(e as Error).message})`)
    }
  }

  if (saved.length === 0) {
    return NextResponse.json({ error: `nothing uploaded. ${failed.join('; ')}` }, { status: 400 })
  }

  // Store the report in English (canonical-English rule); keep the
  // original when it was written in another language.
  const needTranslate = lang !== 'en' && (!!report || !!suggestions)
  const reportEn      = needTranslate ? await translateToEnglish(report, lang) : report
  const suggestionsEn = needTranslate ? await translateToEnglish(suggestions, lang) : suggestions

  const label = category === 'invoice' ? 'invoice' : category === 'photos' ? 'job photos' : 'estimate'
  const noteBody = [
    `Vendor uploaded ${saved.length} ${label} file(s) via the upload portal: ${saved.join(', ')}.`,
    category === 'invoice' ? '→ sent to invoice intake for review.' : '',
    detected.length ? `\n🔎 Detected: ${detected.join('; ')}` : '',
    reportEn      ? `\n📋 Report: ${reportEn}` : '',
    suggestionsEn ? `\n⚠️ Suggestions / issues: ${suggestionsEn}` : '',
    needTranslate && (report || suggestions) ? `\n(original ${lang}: ${[report, suggestions].filter(Boolean).join(' | ')})` : '',
    failed.length ? `\nRejected: ${failed.join('; ')}` : '',
  ].filter(Boolean).join('')
  await appendMessage(ticketId, {
    direction: 'internal_note', channel: 'internal',
    from_addr: wod?.vendor_name ? `Vendor (${wod.vendor_name})` : 'Vendor',
    body: noteBody,
  }).catch(() => null)

  // Nudge an untouched ticket forward so the inbox shows movement.
  if (ticket.status === 'open') await updateTicket(ticketId, { status: 'pending' }, 'vendor-portal').catch(() => null)

  // Notify the assignee (best-effort).
  if (ticket.assignee_email) {
    await sendEmail({
      to: ticket.assignee_email,
      subject: `Vendor uploaded ${label} — ${ticket.ticket_number}`,
      html: `<p>A vendor uploaded <strong>${saved.length} ${label}</strong> file(s) for <strong>${ticket.ticket_number}</strong> via the portal.</p>
             <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'}/admin/tickets/${ticketId}">Open the work order →</a></p>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true, saved: saved.length, failed: failed.length })
}
