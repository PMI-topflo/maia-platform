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
import { lookupAccountRoute } from '@/lib/account-routing'
import { isSignatureOrLogoImage, dedupeAttachments } from '@/lib/email-attachment-filter'
import { normalizePdf, imageToPdf, PDF_TARGET_BYTES } from '@/lib/pdf-normalize'

// Invoices sometimes arrive as a phone photo / scan instead of a PDF.
const INVOICE_IMAGE_RE = /\.(jpe?g|png|heic|heif|webp)$/i
function isInvoiceImage(a: { mimeType: string; filename: string }): boolean {
  return a.mimeType.toLowerCase().startsWith('image/') || INVOICE_IMAGE_RE.test(a.filename)
}

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

  // Idempotency + incremental reprocess. The dedupe key is now
  // (gmail_message_id, gmail_attachment_id) — one draft PER ATTACHMENT,
  // not per email. So a multi-PDF email creates one draft per PDF, and a
  // Pub/Sub redelivery (or a manual reprocess) only fills in attachments
  // that don't already have a draft.
  //
  // Why this changed: the old guard early-returned the moment ANY draft
  // existed for the message, and the table's unique index was on
  // gmail_message_id alone — so for a multi-PDF email only the first PDF
  // ever inserted and the rest hit 23505 and were swallowed (the bug).
  //
  // Legacy rows created before the per-attachment migration carry a NULL
  // gmail_attachment_id. If EVERY existing draft for this message is
  // legacy (no attachment id), treat the email as already fully processed
  // — the old one-draft-per-email behavior — so we never duplicate it.
  // Dedup on the STABLE attachment FILENAME, NOT Gmail's attachmentId —
  // attachmentId changes on every messages.get, so keying on it let every
  // reprocess insert a fresh duplicate (the 2026-06-07 88×-dup incident).
  const { data: existingRows } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('attachment_filename')
    .eq('gmail_message_id', parsed.messageId)
  const existed = existingRows ?? []
  const doneFilenames = new Set(
    existed.map(r => r.attachment_filename as string | null).filter(Boolean) as string[],
  )
  // Rows from before this fix carry a NULL attachment_filename. If EVERY
  // existing draft for this message is legacy (no filename), treat the email
  // as already fully processed — never re-duplicate it.
  if (existed.length > 0 && doneFilenames.size === 0) {
    console.log(`[invoice-intake] msg=${parsed.messageId} already has a legacy/pre-fix draft — skipping`)
    return { created: 0, skipped: parsed.attachments.length, reason: 'already-processed' }
  }

  // Eligible = PDFs OR images (photos/scans), each under the size cap.
  // Images are converted to a one-page PDF below so the rest of the
  // pipeline (storage + CINC attach) is unchanged.
  const eligible = dedupeAttachments(parsed.attachments.filter(a =>
    a.size <= MAX_PDF_BYTES &&
    // PDFs are always real invoices; images only if they're not a vendor
    // signature/logo graphic embedded in the email body.
    (a.mimeType.toLowerCase() === 'application/pdf' || (isInvoiceImage(a) && !isSignatureOrLogoImage(a))),
  ))
  // Skip attachments that already produced a draft (redelivery / reprocess) —
  // matched by stable filename.
  const todo = eligible.filter(a => !doneFilenames.has(a.filename))
  console.log(
    `[invoice-intake] msg=${parsed.messageId} attachments=${parsed.attachments.length} ` +
    `eligible=${eligible.length} alreadyDrafted=${eligible.length - todo.length} toProcess=${todo.length}`,
  )
  if (todo.length === 0) {
    return {
      created: 0,
      skipped: parsed.attachments.length,
      reason:  existed.length ? 'already-processed' : 'no eligible PDF/image attachments',
    }
  }

  // Vendor + association lookups happen once per email, not per PDF.
  const [vendors, assocHint] = await Promise.all([
    listVendorsFull().catch(() => []),
    detectAssociationCode(parsed.subject + ' ' + parsed.body, false).catch(() => null),
  ])

  let created    = 0
  let needsVendor = false
  for (const att of todo) {
    try {
      // Convert image attachments to a one-page PDF up front; PDFs pass through.
      let pdfBytes: Buffer | undefined
      let displayName = att.filename
      if (isInvoiceImage(att)) {
        try {
          pdfBytes = await imageToPdf(await fetchAttachment(att.attachmentId))
          displayName = att.filename.replace(INVOICE_IMAGE_RE, '') + '.pdf'
        } catch (convErr) {
          console.warn(`[invoice-intake] image→PDF failed for ${att.filename}, skipping:`,
            convErr instanceof Error ? convErr.message : convErr)
          continue
        }
      }
      const ok = await processOnePdf({
        parsed, att, vendors, assocHintFromEmail: assocHint, fetchAttachment, pdfBytes, displayName,
      })
      console.log(`[invoice-intake] → ${att.filename} (${att.mimeType}, ${(att.size / 1024).toFixed(0)}KB): ${ok}`)
      if (ok === 'created')      created++
      if (ok === 'needs_vendor') { created++; needsVendor = true }
    } catch (err) {
      console.error(`[invoice-intake] processOnePdf failed for ${att.filename}:`,
        err instanceof Error ? err.message : err)
    }
  }
  console.log(`[invoice-intake] msg=${parsed.messageId} done: created=${created} needsVendor=${needsVendor}`)

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
  pdfBytes?:          Buffer   // already-converted PDF (image attachments); skips fetch
  displayName?:       string   // filename to store/show (image → .pdf)
}): Promise<'created' | 'needs_vendor' | 'skipped'> {
  const { parsed, att, vendors, assocHintFromEmail, fetchAttachment, pdfBytes } = opts
  const fileName = opts.displayName ?? att.filename

  const rawBuf = pdfBytes ?? await fetchAttachment(att.attachmentId)

  // Normalize oversized scans ONCE, here at intake, so every downstream
  // copy (storage / CINC attach / Drive mirror) is the small version.
  // CINC rejects attachments over ~1 MB; phone scans routinely arrive at
  // 20 MB+. Best-effort — returns the original untouched if it's already
  // small, isn't a PDF, or the pipeline fails (see lib/pdf-normalize.ts).
  const norm = await normalizePdf(rawBuf)
  if (norm.changed) {
    console.log(`[invoice-intake] normalized ${fileName}: ${norm.note}`)
  } else if (norm.originalBytes > PDF_TARGET_BYTES) {
    console.warn(`[invoice-intake] ${fileName} still ${(norm.originalBytes / 1e6).toFixed(1)}MB: ${norm.note}`)
  }
  const buf  = norm.buffer
  // Extract from the RAW original (best OCR fidelity for scans) — storage below
  // still keeps the small normalized copy. Fall back to normalized only if the
  // raw file is too big for the model's PDF size limit.
  const b64  = (rawBuf.byteLength <= 20_000_000 ? rawBuf : buf).toString('base64')

  // Storage first (so we can re-push later even if extraction/CINC errors).
  // Path keyed by message + FILENAME (stable). NOT attachmentId — that
  // changes per fetch, so it used to orphan a new file on every reprocess.
  // upsert:true means a reprocess overwrites the same object in place.
  const storageKey = `${parsed.messageId}/${safeFilename(fileName)}`
  const upload = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storageKey, buf, { contentType: 'application/pdf', upsert: true })
  if (upload.error) {
    console.warn(`[invoice-intake] storage upload failed for ${att.filename}: ${upload.error.message}`)
  }

  const extracted = await extractInvoiceFields(b64)
  let   assoc     = (assocHintFromEmail ?? extracted.associationHint ?? '').toUpperCase() || null

  // Vendor matching — null when extractor couldn't find a vendor name.
  let matched = extracted.vendorName ? fuzzyMatchVendor(extracted.vendorName, vendors) : null

  // Account-number routing (utilities). The account number off the bill is
  // unique to a service location, so it resolves the right vendor + association
  // + GL even when the name is ambiguous (Xfinity vs Comcast Business). A known
  // route OVERRIDES the fuzzy name match.
  let routeGlId:   string | null = null
  let routeGlName: string | null = null
  let routePayBy:  string | null = null
  const route = await lookupAccountRoute(extracted.accountNumber).catch(() => null)
  if (route) {
    if (route.cincVendorId) {
      const routeVendor = vendors.find(v => String(v.VendorId) === route.cincVendorId)
      if (routeVendor) matched = routeVendor
    }
    if (route.associationCode) assoc = route.associationCode
    if (route.glAccountId) { routeGlId = route.glAccountId; routeGlName = route.glAccountName }
    if (route.payByType) routePayBy = route.payByType
    console.log(`[invoice-intake] account# "${extracted.accountNumber}" → routed to ${matched?.VendorName ?? '?'} / ${assoc ?? '?'}${routeGlId ? ` / GL ${routeGlName}` : ''}${routePayBy ? ` / ${routePayBy}` : ''}`)
  }

  // Account-number-as-invoice-number fix. Utility bills (Xfinity, etc.) print
  // the account number prominently and often carry NO distinct invoice number,
  // so the extractor sometimes lands the account number in the invoice-number
  // field. When the invoice # IS the account # (or there's an account # but no
  // invoice #), synthesize a CINC-style "<account-tail6>-<MMYYYY>" number —
  // unique per month and consistent with how these are entered in CINC.
  let invoiceNumber = extracted.invoiceNumber
  {
    const acctDigits = (extracted.accountNumber ?? '').replace(/\D/g, '')
    const invDigits  = (extracted.invoiceNumber ?? '').replace(/\D/g, '')
    const isAccountAsInvoice = acctDigits.length >= 6 && invDigits === acctDigits
    const dm = /^(\d{4})-(\d{2})-/.exec(extracted.invoiceDate ?? '')
    if (acctDigits.length >= 6 && dm && (!invoiceNumber || isAccountAsInvoice)) {
      invoiceNumber = `${acctDigits.slice(-6)}-${dm[2]}${dm[1]}`
      console.log(`[invoice-intake] synthesized utility invoice# ${invoiceNumber} (account ${extracted.accountNumber})`)
    }
  }

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
  } else if (assoc && invoiceNumber) {
    try {
      const dups = await checkDuplicateInvoice({
        associationCode: assoc,
        vendorId:        matched.VendorId,
        invoiceNumber:   invoiceNumber,
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
    gmail_attachment_id:        att.attachmentId,   // kept for reference (volatile — NOT the dedup key)
    attachment_filename:        att.filename,       // STABLE per-attachment dedup key
    pdf_storage_key:            upload.error ? null : storageKey,
    extracted_vendor_name:      extracted.vendorName,
    matched_cinc_vendor_id:     matched ? String(matched.VendorId) : null,
    matched_vendor_name:        matched?.VendorName  ?? null,
    matched_vendor_short_name:  matched?.UserDefined1 ?? null,
    extracted_invoice_number:   invoiceNumber,
    extracted_amount:           extracted.amount,
    extracted_association_code: assoc,
    extracted_invoice_date:     extracted.invoiceDate,
    extracted_account_number:   extracted.accountNumber,
    extracted_description:      extracted.description,
    extraction_confidence:      extracted.confidence,
    status,
    cinc_dup_invoice_id:        cincDupId,
    ...(routeGlId ? { gl_account_id: routeGlId, gl_account_name: routeGlName } : {}),
    ...(routePayBy ? { pay_by_type: routePayBy } : {}),
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
}): Promise<{ ok: boolean; status: DraftStatus | 'error'; draftId?: number; reason?: string }> {
  const norm = await normalizePdf(opts.buf)
  const bytes = norm.buffer
  // Extract from the raw original (best OCR fidelity); store the normalized copy.
  const b64 = (opts.buf.byteLength <= 20_000_000 ? opts.buf : bytes).toString('base64')

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
    extracted_account_number:   extracted?.accountNumber ?? null,
    extraction_confidence:      extracted?.confidence ?? null,
    status,
    cinc_dup_invoice_id:        cincDupId,
  }).select('id').single()

  if (error) { console.error(`[invoice-intake] vendor-portal draft insert failed: ${error.message}`); return { ok: false, status: 'error', reason: error.message } }
  return { ok: true, status, draftId: data?.id as number }
}

/** Create an invoice-intake draft from a STAFF MANUAL UPLOAD (someone dropped
 *  a PDF/image on the /admin/invoices page, or used "Add invoice" from an
 *  association). Mirrors processOnePdf's extraction + vendor-match + duplicate
 *  pre-check, but the source is a file rather than a Gmail attachment. An
 *  optional associationCode (e.g. from the association the staffer came from)
 *  takes precedence over the extractor's guess. Lands in the normal review
 *  queue (pending_review / needs_vendor / duplicate_in_cinc). No vendor ack
 *  is sent — there's no inbound sender. */
export async function createManualInvoiceDraft(opts: {
  buf:              Buffer
  filename:         string
  associationCode?: string | null
}): Promise<{ ok: boolean; status: DraftStatus | 'error'; draftId?: number; reason?: string }> {
  const bucket = await ensureBucket()
  if (!bucket.ok) return { ok: false, status: 'error', reason: bucket.reason }

  // Convert images to a one-page PDF, then normalize oversized scans so every
  // downstream copy (storage / CINC attach / Drive mirror) is the small version.
  let pdfBuf = opts.buf
  let displayName = opts.filename
  if (INVOICE_IMAGE_RE.test(opts.filename)) {
    try {
      pdfBuf = await imageToPdf(opts.buf)
      displayName = opts.filename.replace(INVOICE_IMAGE_RE, '') + '.pdf'
    } catch (err) {
      return { ok: false, status: 'error', reason: `image→PDF failed: ${err instanceof Error ? err.message : err}` }
    }
  }
  const norm = await normalizePdf(pdfBuf)
  const bytes = norm.buffer
  // Extract from the raw original (best OCR fidelity); store the normalized copy.
  const b64 = (pdfBuf.byteLength <= 20_000_000 ? pdfBuf : bytes).toString('base64')

  const uid = globalThis.crypto.randomUUID()
  const storageKey = `manual-upload/${uid}/${safeFilename(displayName)}`
  const upload = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storageKey, bytes, { contentType: 'application/pdf', upsert: true })
  if (upload.error) console.warn(`[invoice-intake] manual upload storage failed: ${upload.error.message}`)

  const extracted = await extractInvoiceFields(b64).catch(() => null)
  const assoc = (opts.associationCode ?? extracted?.associationHint ?? '').toUpperCase() || null

  const vendors = await listVendorsFull().catch(() => [])
  const matched = extracted?.vendorName ? fuzzyMatchVendor(extracted.vendorName, vendors) : null

  let status: DraftStatus = matched ? 'pending_review' : 'needs_vendor'
  let cincDupId: string | null = null
  if (matched && assoc && extracted?.invoiceNumber) {
    try {
      const dups = await checkDuplicateInvoice({ associationCode: assoc, vendorId: matched.VendorId, invoiceNumber: extracted.invoiceNumber })
      if (dups.length > 0) { status = 'duplicate_in_cinc'; cincDupId = String(dups[0].InvoiceID) }
    } catch { /* non-fatal */ }
  }

  const { data, error } = await supabaseAdmin.from('invoice_intake_drafts').insert({
    gmail_message_id:           `manual-upload:${uid}`,
    attachment_filename:        displayName,
    pdf_storage_key:            upload.error ? null : storageKey,
    extracted_vendor_name:      extracted?.vendorName ?? null,
    matched_cinc_vendor_id:     matched ? String(matched.VendorId) : null,
    matched_vendor_name:        matched?.VendorName  ?? null,
    matched_vendor_short_name:  matched?.UserDefined1 ?? null,
    extracted_invoice_number:   extracted?.invoiceNumber ?? null,
    extracted_amount:           extracted?.amount ?? null,
    extracted_association_code: assoc,
    extracted_invoice_date:     extracted?.invoiceDate ?? null,
    extracted_account_number:   extracted?.accountNumber ?? null,
    extracted_description:      extracted?.description ?? null,
    extraction_confidence:      extracted?.confidence ?? null,
    status,
    cinc_dup_invoice_id:        cincDupId,
  }).select('id').single()

  if (error) { console.error(`[invoice-intake] manual draft insert failed: ${error.message}`); return { ok: false, status: 'error', reason: error.message } }
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
