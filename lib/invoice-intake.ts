// =====================================================================
// lib/invoice-intake.ts
//
// Phase-1 invoice intake. Called from the staff-Gmail webhook when an
// email arrives at billing@topfloridaproperties.com with PDF
// attachments. For each PDF:
//
//   1. Upload to the `invoice-intake-pdfs` Supabase bucket
//   2. Extract structured fields via Claude (lib/invoice-extraction.ts)
//   3. Fuzzy-match the vendor against the CINC catalog
//   4. Pre-check CINC's duplicate-invoice endpoint
//   5. Insert a row into `invoice_intake_drafts` for Karen to review
//   6. Send a brief ack to the sender, idempotent on gmail_message_id
//
// Karen reviews in /admin/invoices and clicks Push to CINC. The actual
// push (createInvoice + attachInvoicePdf) lives in the API route, not
// here — handleInvoiceIntake is intake-only.
// =====================================================================

import { supabaseAdmin }  from '@/lib/supabase-admin'
import { sendEmail }      from '@/lib/gmail'
import { logEmail }       from '@/lib/email-logger'
import { detectAssociationCode } from '@/lib/maia-command-processor'
import type { ParsedEmail } from '@/lib/maia-command-processor'
import {
  listVendorsFull,
  fuzzyMatchVendor,
  checkDuplicateInvoice,
} from '@/lib/integrations/cinc'
import { extractInvoiceFields } from '@/lib/invoice-extraction'
import { normalizePdf, PDF_TARGET_BYTES } from '@/lib/pdf-normalize'

const STORAGE_BUCKET           = 'invoice-intake-pdfs'
const MAX_PDF_BYTES            = 25 * 1024 * 1024   // CINC's hard limit
const KAREN_ALERT_TO           = process.env.MAIA_BILLING_ALERT_TO ?? 'billing@topfloridaproperties.com'
const APP_URL                  = process.env.NEXT_PUBLIC_APP_URL  ?? 'https://www.pmitop.com'

type DraftStatus = 'pending_review' | 'needs_vendor' | 'duplicate_in_cinc' | 'pushed_to_cinc' | 'rejected'

let _bucketEnsured = false
async function ensureBucket(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (_bucketEnsured) return { ok: true }
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets()
  if (listErr) return { ok: false, reason: `listBuckets failed: ${listErr.message}` }
  if (buckets?.some(b => b.name === STORAGE_BUCKET)) {
    _bucketEnsured = true
    return { ok: true }
  }
  const { error: createErr } = await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
    public:        false,
    fileSizeLimit: MAX_PDF_BYTES,
  })
  if (createErr) return { ok: false, reason: `createBucket failed: ${createErr.message}` }
  _bucketEnsured = true
  return { ok: true }
}

/** Top-level intake. Called once per inbound email from the staff
 *  webhook. Handles ALL PDFs on the email; non-PDF / oversize
 *  attachments are skipped (Karen handles those manually). Returns
 *  the number of drafts created. */
export async function handleInvoiceIntake(
  parsed:          ParsedEmail,
  fetchAttachment: (attachmentId: string) => Promise<Buffer>,
): Promise<{ created: number; skipped: number; reason?: string }> {
  // Bucket check first — without storage we can't keep the PDF for re-push.
  const bucket = await ensureBucket()
  if (!bucket.ok) {
    console.error(`[invoice-intake] ${bucket.reason}`)
    return { created: 0, skipped: 0, reason: bucket.reason }
  }

  // Idempotency: if a draft already exists for this gmail message, no-op.
  // Without this guard, Pub/Sub redeliveries + dual-mailbox processing
  // would each create another draft for the same email.
  const { data: existing } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id')
    .eq('gmail_message_id', parsed.messageId)
    .limit(1)
    .maybeSingle()
  if (existing) {
    return { created: 0, skipped: 0, reason: 'already-processed' }
  }

  const pdfs = parsed.attachments.filter(a =>
    a.mimeType.toLowerCase() === 'application/pdf' && a.size <= MAX_PDF_BYTES,
  )
  if (pdfs.length === 0) {
    return { created: 0, skipped: parsed.attachments.length, reason: 'no eligible PDF attachments' }
  }

  // Vendor + association lookups happen once per email, not per PDF.
  const [vendors, assocHint] = await Promise.all([
    listVendorsFull().catch(() => []),
    detectAssociationCode(parsed.subject + ' ' + parsed.body, false).catch(() => null),
  ])

  let created    = 0
  let needsVendor = false
  for (const att of pdfs) {
    try {
      const ok = await processOnePdf({
        parsed, att, vendors, assocHintFromEmail: assocHint, fetchAttachment,
      })
      if (ok === 'created')      created++
      if (ok === 'needs_vendor') { created++; needsVendor = true }
    } catch (err) {
      console.error(`[invoice-intake] processOnePdf failed for ${att.filename}:`,
        err instanceof Error ? err.message : err)
    }
  }

  // Brief vendor-facing ack. Idempotency: we already checked the
  // gmail_message_id at the top; if we got here we created at least
  // one draft from this email. Pub/Sub redelivery would hit the
  // early-return guard above and never reach this point.
  if (created > 0) {
    await sendVendorAck(parsed)
  }

  // If any PDF needed a vendor that isn't in CINC, alert Karen so she
  // can create it and re-match. One alert per email, not per PDF.
  if (needsVendor) {
    await sendKarenVendorNeededAlert(parsed).catch(err =>
      console.warn('[invoice-intake] Karen alert failed:', err instanceof Error ? err.message : err))
  }

  return { created, skipped: parsed.attachments.length - created }
}

async function processOnePdf(opts: {
  parsed:             ParsedEmail
  att:                ParsedEmail['attachments'][number]
  vendors:            Awaited<ReturnType<typeof listVendorsFull>>
  assocHintFromEmail: string | null
  fetchAttachment:    (attachmentId: string) => Promise<Buffer>
}): Promise<'created' | 'needs_vendor' | 'skipped'> {
  const { parsed, att, vendors, assocHintFromEmail, fetchAttachment } = opts

  const rawBuf = await fetchAttachment(att.attachmentId)

  // Normalize oversized scans ONCE, here at intake, so every downstream
  // copy (storage / CINC attach / Drive mirror) is the small version.
  // CINC rejects attachments over ~1 MB; phone scans routinely arrive at
  // 20 MB+. Best-effort — returns the original untouched if it's already
  // small, isn't a PDF, or the pipeline fails (see lib/pdf-normalize.ts).
  const norm = await normalizePdf(rawBuf)
  if (norm.changed) {
    console.log(`[invoice-intake] normalized ${att.filename}: ${norm.note}`)
  } else if (norm.originalBytes > PDF_TARGET_BYTES) {
    console.warn(`[invoice-intake] ${att.filename} still ${(norm.originalBytes / 1e6).toFixed(1)}MB: ${norm.note}`)
  }
  const buf  = norm.buffer
  const b64  = buf.toString('base64')

  // Storage first (so we can re-push later even if extraction/CINC errors).
  // Path includes message + attachment id for uniqueness across retries.
  const storageKey = `${parsed.messageId}/${att.attachmentId}/${safeFilename(att.filename)}`
  const upload = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storageKey, buf, { contentType: 'application/pdf', upsert: true })
  if (upload.error) {
    console.warn(`[invoice-intake] storage upload failed for ${att.filename}: ${upload.error.message}`)
  }

  const extracted = await extractInvoiceFields(b64)
  let   assoc     = (assocHintFromEmail ?? extracted.associationHint ?? '').toUpperCase() || null

  // Vendor matching — null when extractor couldn't find a vendor name.
  const matched = extracted.vendorName ? fuzzyMatchVendor(extracted.vendorName, vendors) : null

  // Auto-association fallback: when neither the email text nor the PDF named
  // an association, infer it from this vendor's own confirmed history in
  // MAIA. If every association a human has already approved for this exact
  // CINC vendor is the same one, it's a safe inference (recurring vendors
  // like Arrow Asphalt → VPREC). Ambiguous (vendor serves several assocs) or
  // no history → stay null and land in review. Karen still confirms the
  // association on the audit checklist either way, so this only removes the
  // by-hand first guess, it doesn't push anything unverified.
  if (!assoc && matched) {
    const inferred = await inferAssocFromVendorHistory(String(matched.VendorId))
    if (inferred) {
      assoc = inferred
      console.log(`[invoice-intake] association ${assoc} inferred from confirmed history of vendor ${matched.VendorName} (#${matched.VendorId})`)
    }
  }

  // Duplicate pre-check — only if we have all three keys.
  let status: DraftStatus = 'pending_review'
  let cincDupId: string | null = null
  if (!matched) {
    status = 'needs_vendor'
  } else if (assoc && extracted.invoiceNumber) {
    try {
      const dups = await checkDuplicateInvoice({
        associationCode: assoc,
        vendorId:        matched.VendorId,
        invoiceNumber:   extracted.invoiceNumber,
      })
      if (dups.length > 0) {
        status     = 'duplicate_in_cinc'
        cincDupId  = String(dups[0].InvoiceID)
      }
    } catch (err) {
      console.warn(`[invoice-intake] duplicate pre-check failed: ${(err as Error).message}`)
    }
  }

  const { error: insertErr } = await supabaseAdmin.from('invoice_intake_drafts').insert({
    gmail_message_id:           parsed.messageId,
    pdf_storage_key:            upload.error ? null : storageKey,
    extracted_vendor_name:      extracted.vendorName,
    matched_cinc_vendor_id:     matched ? String(matched.VendorId) : null,
    matched_vendor_name:        matched?.VendorName  ?? null,
    matched_vendor_short_name:  matched?.UserDefined1 ?? null,
    extracted_invoice_number:   extracted.invoiceNumber,
    extracted_amount:           extracted.amount,
    extracted_association_code: assoc,
    extracted_invoice_date:     extracted.invoiceDate,
    due_date:                   extracted.dueDate,
    extraction_confidence:      extracted.confidence,
    status,
    cinc_dup_invoice_id:        cincDupId,
  })

  if (insertErr) {
    // Unique-index hit on gmail_message_id → another concurrent call
    // already created this draft. Treat as success (idempotent).
    if (insertErr.code === '23505') return 'skipped'
    console.error(`[invoice-intake] insert failed: ${insertErr.message}`)
    return 'skipped'
  }

  return status === 'needs_vendor' ? 'needs_vendor' : 'created'
}

function safeFilename(name: string): string {
  return (name ?? 'invoice.pdf')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120)
}

/** Infer an association for an invoice that arrived without one, using this
 *  vendor's own history in MAIA. Only counts drafts whose association a human
 *  already validated (ready-to-push or pushed) so we never learn from an
 *  earlier unconfirmed guess. Returns the code only when that history is
 *  unanimous — a vendor that bills several associations stays ambiguous and
 *  is left for manual selection. */
async function inferAssocFromVendorHistory(cincVendorId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('extracted_association_code')
    .eq('matched_cinc_vendor_id', cincVendorId)
    .in('status', ['ready_to_push', 'pushed_to_cinc'])
    .not('extracted_association_code', 'is', null)
    .limit(100)
  if (error || !data || data.length === 0) return null
  const distinct = Array.from(new Set(
    data.map(r => (r.extracted_association_code as string | null)?.toUpperCase()).filter(Boolean) as string[],
  ))
  return distinct.length === 1 ? distinct[0] : null
}

/** Create an invoice-intake draft from a VENDOR-PORTAL upload (a vendor
 *  uploaded an invoice via the tokenized link on a work order). Mirrors
 *  processOnePdf but is pre-tagged with the work order's association +
 *  vendor + WO number, and linked to the ticket. Lands in the normal
 *  intake review queue (pending_review / needs_vendor / duplicate_in_cinc).
 *  Best-effort vendor match by the WO's vendor name, then the extractor's. */
export async function createInvoiceDraftFromUpload(opts: {
  ticketId:         number
  associationCode:  string | null
  vendorName:       string | null
  workOrderNumber:  number | null
  buf:              Buffer
  filename:         string
}): Promise<{ ok: boolean; status: DraftStatus | 'error'; draftId?: number }> {
  const norm = await normalizePdf(opts.buf)
  const bytes = norm.buffer
  const b64 = bytes.toString('base64')

  const storageKey = `vendor-portal/${opts.ticketId}/${Date.now()}-${safeFilename(opts.filename)}`
  const upload = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storageKey, bytes, { contentType: 'application/pdf', upsert: true })
  if (upload.error) console.warn(`[invoice-intake] vendor-portal upload failed: ${upload.error.message}`)

  const extracted = await extractInvoiceFields(b64).catch(() => null)
  const assoc = (opts.associationCode ?? extracted?.associationHint ?? '').toUpperCase() || null

  const vendors = await listVendorsFull().catch(() => [])
  const matchName = extracted?.vendorName || opts.vendorName || null
  const matched = matchName ? fuzzyMatchVendor(matchName, vendors) : null

  let status: DraftStatus = matched ? 'pending_review' : 'needs_vendor'
  let cincDupId: string | null = null
  if (matched && assoc && extracted?.invoiceNumber) {
    try {
      const dups = await checkDuplicateInvoice({ associationCode: assoc, vendorId: matched.VendorId, invoiceNumber: extracted.invoiceNumber })
      if (dups.length > 0) { status = 'duplicate_in_cinc'; cincDupId = String(dups[0].InvoiceID) }
    } catch { /* non-fatal */ }
  }

  const { data, error } = await supabaseAdmin.from('invoice_intake_drafts').insert({
    gmail_message_id:           `vendor-portal:${opts.ticketId}:${globalThis.crypto.randomUUID()}`,
    ticket_id:                  opts.ticketId,
    work_order_number:          opts.workOrderNumber,
    pdf_storage_key:            upload.error ? null : storageKey,
    extracted_vendor_name:      extracted?.vendorName ?? opts.vendorName ?? null,
    matched_cinc_vendor_id:     matched ? String(matched.VendorId) : null,
    matched_vendor_name:        matched?.VendorName  ?? null,
    matched_vendor_short_name:  matched?.UserDefined1 ?? null,
    extracted_invoice_number:   extracted?.invoiceNumber ?? null,
    extracted_amount:           extracted?.amount ?? null,
    extracted_association_code: assoc,
    extracted_invoice_date:     extracted?.invoiceDate ?? null,
    due_date:                   extracted?.dueDate ?? null,
    extraction_confidence:      extracted?.confidence ?? null,
    status,
    cinc_dup_invoice_id:        cincDupId,
  }).select('id').single()

  if (error) { console.error(`[invoice-intake] vendor-portal draft insert failed: ${error.message}`); return { ok: false, status: 'error' } }
  return { ok: true, status, draftId: data?.id as number }
}

async function sendVendorAck(parsed: ParsedEmail): Promise<void> {
  const subject = parsed.subject.startsWith('Re:') ? parsed.subject : `Re: ${parsed.subject}`
  const html    = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="margin-top:0">Got it — your invoice has been received and is with our billing team for review.</p>
<p style="color:#6b7280;font-size:12px;margin:6px 0 0">You'll hear back once it's been processed. No further action needed from you.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`
  try {
    const { messageId } = await sendEmail({
      to:      parsed.senderEmail,
      subject,
      html,
      ...(parsed.rfcMessageId && {
        headers: { 'In-Reply-To': parsed.rfcMessageId, References: parsed.rfcMessageId },
      }),
    })
    void logEmail({
      direction:       'outbound',
      toEmail:         parsed.senderEmail,
      subject,
      fullBody:        html,
      persona:         'staff',
      status:          'sent',
      resendMessageId: messageId,
      sentBy:          'maia-invoice-intake',
      gmailThreadId:   parsed.threadId,
    })
  } catch (err) {
    console.warn('[invoice-intake] vendor ack failed:', err instanceof Error ? err.message : err)
  }
}

async function sendKarenVendorNeededAlert(parsed: ParsedEmail): Promise<void> {
  const subject = `Invoice intake — vendor not in CINC (from ${parsed.senderEmail})`
  const html    = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p style="margin-top:0">An invoice came in from <strong>${parsed.senderEmail}</strong> but MAIA couldn't match the vendor to any record in CINC.</p>
<p>Create the vendor in CINC, then open the draft below and click <em>Re-match</em>.</p>
<p style="margin:24px 0"><a href="${APP_URL}/admin/invoices?status=needs_vendor" style="background:#f26a1b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:500">Open intake queue</a></p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">MAIA · PMI Top Florida Properties</p>
</body></html>`
  await sendEmail({ to: KAREN_ALERT_TO, subject, html })
}
