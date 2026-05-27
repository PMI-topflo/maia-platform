// =====================================================================
// app/api/admin/invoices/intake/[id]/push/route.ts
// POST — push a reviewed draft to CINC.
//
// Flow:
//   1. Load draft, validate it's actionable (pending_review or
//      duplicate_in_cinc with explicit override).
//   2. Build canonical filename: <assoc>_<short>_<inv#>_$<amount>.pdf
//   3. Download PDF from Supabase storage.
//   4. createInvoice → captures cinc_invoice_id.
//   5. attachInvoicePdf → attaches the file.
//   6. Mark draft pushed_to_cinc.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import {
  createInvoice,
  attachInvoicePdf,
  createInvoiceNote,
  listAssociationBankAccounts,
  CincApiError,
} from '@/lib/integrations/cinc'
import { uploadInvoiceToDrive } from '@/lib/drive-invoice-mirror'

// Karen's inbox — the assignee + author for every auto-resolved
// "invoice processed" ticket. Same env as the needs-vendor alert.
const KAREN_EMAIL = process.env.MAIA_BILLING_ALERT_TO ?? 'billing@topfloridaproperties.com'

export const dynamic = 'force-dynamic'

const STORAGE_BUCKET = 'invoice-intake-pdfs'

interface PushBody {
  /** Set to true to push despite duplicate_in_cinc status. */
  pushAnyway?: boolean
}

async function getStaffLoginEmail(): Promise<string | null> {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : null
}

export async function POST(
  req:    Request,
  ctx:    { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const pushedBy = await getStaffLoginEmail()
  if (!pushedBy) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: PushBody = {}
  try { body = await req.json() } catch { /* allow empty body */ }

  const { data: draft, error: loadErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, status, pdf_storage_key, matched_cinc_vendor_id, matched_vendor_name, matched_vendor_short_name, extracted_invoice_number, extracted_amount, extracted_association_code, extracted_invoice_date, pay_by_type, observation_note, work_order_number, pay_from_bank_account_id, extraction_confidence, gmail_message_id')
    .eq('id', id)
    .single()
  if (loadErr || !draft) return NextResponse.json({ error: loadErr?.message ?? 'not found' }, { status: 404 })

  // Status gate.
  if (draft.status === 'pushed_to_cinc') {
    return NextResponse.json({ error: 'already pushed to CINC' }, { status: 400 })
  }
  if (draft.status === 'rejected') {
    return NextResponse.json({ error: 'cannot push a rejected draft' }, { status: 400 })
  }
  if (draft.status === 'needs_vendor' || !draft.matched_cinc_vendor_id) {
    return NextResponse.json({ error: 'no CINC vendor matched — assign one before pushing' }, { status: 400 })
  }
  if (draft.status === 'duplicate_in_cinc' && !body.pushAnyway) {
    return NextResponse.json({ error: 'duplicate flagged — set pushAnyway=true to override' }, { status: 409 })
  }
  // Required-field gate.
  const missing: string[] = []
  if (!draft.extracted_invoice_number)   missing.push('invoice_number')
  if (!draft.extracted_amount)           missing.push('amount')
  if (!draft.extracted_association_code) missing.push('association_code')
  if (!draft.extracted_invoice_date)     missing.push('invoice_date')
  if (!draft.pdf_storage_key)            missing.push('pdf_storage_key')
  if (missing.length > 0) {
    return NextResponse.json({ error: `missing required fields: ${missing.join(', ')}` }, { status: 400 })
  }

  // Pull PDF bytes from storage.
  const { data: blob, error: dlErr } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .download(draft.pdf_storage_key as string)
  if (dlErr || !blob) {
    return NextResponse.json({ error: `storage download failed: ${dlErr?.message ?? 'no blob'}` }, { status: 500 })
  }
  const buf = Buffer.from(await blob.arrayBuffer())
  const pdfBase64 = buf.toString('base64')

  // Push to CINC. createInvoice defaults StatusID to PENDING APPROVAL
  // (board approves in WebAxis afterward). Sends Karen's observation as
  // NoteDescription so the CINC team sees processing instructions when
  // they open the invoice. PayFromBankAccountID routes the payment to
  // the Operating / Reserve / Special Assessment bank account Karen
  // picked; null means "let CINC default to operating" (BankAccountID 0).
  const payFromBankAccountId = (draft.pay_from_bank_account_id ?? null) as number | null
  let cincInvoiceId: number
  try {
    const created = await createInvoice({
      associationCode:      draft.extracted_association_code as string,
      vendorId:             parseInt(draft.matched_cinc_vendor_id as string, 10),
      invoiceNumber:        draft.extracted_invoice_number    as string,
      invoiceDate:          draft.extracted_invoice_date      as string,
      amount:               draft.extracted_amount            as number,
      payByType:            (draft.pay_by_type      ?? null) as string | null,
      noteDescription:      (draft.observation_note ?? null) as string | null,
      workOrderNumber:      (draft.work_order_number ?? null) as number | null,
      payFromBankAccountId: payFromBankAccountId,
    })
    cincInvoiceId = created.invoiceId
  } catch (err) {
    const message = err instanceof CincApiError ? err.message : (err as Error).message
    return NextResponse.json({ error: `CINC createInvoice failed: ${message}` }, { status: 502 })
  }

  // Attach PDF with the canonical rename.
  const filename = canonicalInvoiceFilename({
    association: draft.extracted_association_code as string,
    short:       draft.matched_vendor_short_name  ?? 'Vendor',
    invoiceNo:   draft.extracted_invoice_number   as string,
    amount:      draft.extracted_amount           as number,
  })
  try {
    await attachInvoicePdf({ invoiceId: cincInvoiceId, pdfBase64, filename })
  } catch (err) {
    // Invoice header was created but the file failed — flag in the draft
    // so Karen can manually attach in CINC. Don't roll back the header
    // (CINC has no rollback; manual void is the only recourse).
    const message = err instanceof CincApiError ? err.message : (err as Error).message
    await supabaseAdmin
      .from('invoice_intake_drafts')
      .update({
        status:          'pushed_to_cinc',
        cinc_invoice_id: String(cincInvoiceId),
        pushed_at:       new Date().toISOString(),
        pushed_by:       pushedBy,
        rejected_reason: `PDF attach failed: ${message}`,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', id)
    return NextResponse.json({
      warning: `Invoice header created (CINC id ${cincInvoiceId}) but PDF attachment failed: ${message}. Attach manually in CINC.`,
      cincInvoiceId,
    }, { status: 207 })
  }

  // Provenance note — gives anyone viewing the invoice in CINC the
  // origin story (MAIA pulled it from <sender> with X% confidence).
  // Best-effort: failure logged but doesn't fail the push.
  try {
    const conf = draft.extraction_confidence != null
      ? `${Math.round((draft.extraction_confidence as number) * 100)}% extraction confidence`
      : 'extraction confidence unavailable'
    await createInvoiceNote({
      invoiceId: cincInvoiceId,
      content:   `Auto-ingested by MAIA on ${new Date().toISOString().slice(0, 10)} (${conf}). Pushed by ${pushedBy}. Filename: ${filename}.`,
    })
  } catch (err) {
    console.warn(`[invoice-push] provenance note failed: ${(err as Error).message}`)
  }

  // Audit note when Karen pays from anything other than the Operating
  // account — board-visible provenance trail. Two flavors:
  //   - Restricted accounts (Insurance Proceeds, Loan Proceeds): note
  //     carries the restriction label explicitly so the board sees this
  //     was an earmarked disbursement.
  //   - Plain non-operating (Reserve / Special Assessment): kind label
  //     plus account description.
  // We resolve the picked account from the live CINC list (unfiltered
  // helper, so restricted accounts still resolve even though they're
  // not in Karen's dropdown). Best-effort: failure logged but non-fatal.
  if (payFromBankAccountId != null && payFromBankAccountId !== 0) {
    try {
      const accounts = await listAssociationBankAccounts(draft.extracted_association_code as string)
      const picked   = accounts.find(a => a.id === payFromBankAccountId)
      if (picked && (picked.restricted || picked.kind !== 'operating')) {
        let content: string
        if (picked.restricted) {
          content = `Payment source: RESTRICTED — ${picked.restrictionLabel} account (${picked.description}). Funds disbursed per the underlying earmarked purpose. Selected by ${pushedBy} via MAIA.`
        } else {
          const kindLabel =
            picked.kind === 'reserve' ? 'Reserve'
            : picked.kind === 'special' ? 'Special Assessment'
            : picked.kind
          content = `Payment source: ${kindLabel} account (${picked.description}) — selected by ${pushedBy} via MAIA.`
        }
        await createInvoiceNote({ invoiceId: cincInvoiceId, content })
      }
    } catch (err) {
      console.warn(`[invoice-push] non-operating audit note failed: ${(err as Error).message}`)
    }
  }

  // Drive mirror — best-effort. Failure is non-fatal: the CINC push
  // is the source of truth; Drive is a convenience copy so Isabela's
  // existing folder-move + spreadsheet workflow keeps working. If the
  // SA doesn't have access to the folder yet (one-time share step),
  // every push will warn but CINC stays correct.
  let driveFileId: string | null = null
  let driveWarning: string | null = null
  try {
    const mirror = await uploadInvoiceToDrive({ filename, pdfBuffer: buf })
    driveFileId = mirror.driveFileId
  } catch (err) {
    driveWarning = `Drive mirror failed: ${(err as Error).message}`
    console.warn(`[invoice-push] ${driveWarning}`)
  }

  // Mark pushed.
  const { error: updErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .update({
      status:          'pushed_to_cinc',
      cinc_invoice_id: String(cincInvoiceId),
      drive_file_id:   driveFileId,
      pushed_at:       new Date().toISOString(),
      pushed_by:       pushedBy,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', id)
  if (updErr) {
    return NextResponse.json({
      warning: `Pushed to CINC (id ${cincInvoiceId}) but failed to update draft state: ${updErr.message}`,
      cincInvoiceId,
      driveFileId,
    }, { status: 207 })
  }

  // Monthly-report ticket. We auto-create + immediately resolve a
  // ticket under the "Financial & Billing" category, assigned to
  // Karen, so each invoice she processes counts in her monthly stats
  // without her having to file one manually. Best-effort — failure
  // logged but doesn't fail the push.
  await createResolvedInvoiceTicket({
    draftAssoc:   draft.extracted_association_code as string | null,
    vendorName:   (draft.matched_vendor_name ?? draft.matched_vendor_short_name) as string | null,
    invoiceNum:   draft.extracted_invoice_number as string,
    amount:       draft.extracted_amount as number,
    cincInvoiceId,
    pushedBy,
  }).catch(err => {
    console.warn(`[invoice-push] auto-ticket failed: ${(err as Error).message}`)
  })

  if (driveWarning) {
    return NextResponse.json({
      ok:       true,
      warning:  driveWarning,
      cincInvoiceId,
    }, { status: 207 })
  }

  return NextResponse.json({ ok: true, cincInvoiceId, driveFileId })
}

/** Insert a resolved ticket so the invoice push counts in Karen's
 *  monthly "Financial & Billing" totals. Direct insert (vs. going
 *  through createTicket) because we want it born resolved — saves an
 *  open→resolved patch and the ticket_events for it. */
async function createResolvedInvoiceTicket(opts: {
  draftAssoc:    string | null
  vendorName:    string | null
  invoiceNum:    string
  amount:        number
  cincInvoiceId: number
  pushedBy:      string
}): Promise<void> {
  const subject = `Invoice processed — ${opts.vendorName ?? 'vendor'} #${opts.invoiceNum} · $${opts.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const summary = `Pushed to CINC as invoice ${opts.cincInvoiceId} by ${opts.pushedBy} on ${new Date().toISOString().slice(0, 10)}.`
  const nowIso  = new Date().toISOString()

  const { data: inserted, error } = await supabaseAdmin
    .from('tickets')
    .insert({
      type:             'ticket',
      status:           'resolved',
      priority:         'low',
      channel_origin:   'email',
      association_code: opts.draftAssoc,
      persona:          'staff',
      contact_name:     opts.vendorName,
      subject,
      summary,
      assignee_email:   KAREN_EMAIL.toLowerCase(),
      ticket_category:  'Financial & Billing',
      created_by_maia:  true,
      resolved_at:      nowIso,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.warn(`[invoice-push] auto-ticket insert failed: ${error?.message}`)
    return
  }

  // Audit trail so the monthly report sees a creation event.
  await supabaseAdmin.from('ticket_events').insert({
    ticket_id:   inserted.id,
    actor_email: 'maia-invoice-intake',
    event_type:  'created',
    payload:     { channel_origin: 'email', type: 'ticket', auto_resolved: true, cinc_invoice_id: opts.cincInvoiceId },
  })
}

function canonicalInvoiceFilename(opts: {
  association: string
  short:       string
  invoiceNo:   string
  amount:      number
}): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  const amt  = opts.amount.toFixed(2).replace(/\.00$/, '')
  return `${safe(opts.association)}_${safe(opts.short)}_${safe(opts.invoiceNo)}_$${amt}.pdf`
}
