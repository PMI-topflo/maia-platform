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
  createInvoiceExpenseItems,
  deleteInvoiceExpenseItems,
  getCincInvoice,
  listAssociationBankAccounts,
  getAssociationBudget,
  CincApiError,
} from '@/lib/integrations/cinc'
import { recordAccountRoute } from '@/lib/account-routing'
import { uploadInvoiceToDrive } from '@/lib/drive-invoice-mirror'
import { normalizePdf } from '@/lib/pdf-normalize'
import { trustedDomainVariants } from '@/lib/staff-lookup'

// CINC rejects invoice attachments over ~1 MB. The bug wasn't the limit —
// it was WHAT we measured: the old gate compared the BASE64-encoded length
// (which is ~33% larger than the file) to 1 MB, so a 736 KB FILE looked like
// 1.00 MB and was refused even though CINC accepts it. We now gate on the
// actual FILE size. normalizePdf still shrinks oversized phone scans first
// (it intentionally leaves born-digital text PDFs — e.g. a Breezeline e-bill
// — alone, since rasterizing would destroy their text layer).
const CINC_ATTACH_TARGET_BYTES = 700_000      // binary target fed to normalizePdf
const CINC_ATTACH_MAX_BYTES    = 1_000_000    // hard refusal — CINC's ~1 MB FILE limit

// Window for the cross-invoice double-pay guard: a same vendor + amount +
// association invoice already pushed/queued within this many days hard-blocks
// the push unless Karen explicitly overrides (pushAnyway).
const DUP_GUARD_DAYS = 60

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
    .select('id, status, pdf_storage_key, drive_file_id, matched_cinc_vendor_id, matched_vendor_name, matched_vendor_short_name, extracted_invoice_number, extracted_amount, extracted_association_code, extracted_invoice_date, extracted_account_number, due_date, scheduled_pay_date, pay_by_type, observation_note, work_order_number, pay_from_bank_account_id, gl_account_id, gl_account_name, extraction_confidence, gmail_message_id')
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
  // Audit gate: the AP team must complete the checklist and mark the draft
  // 'ready_to_push' before it can post to CINC (prevents un-reviewed /
  // duplicate pushes). duplicate_in_cinc with pushAnyway is the only bypass.
  if (draft.status !== 'ready_to_push' && !(draft.status === 'duplicate_in_cinc' && body.pushAnyway)) {
    return NextResponse.json({ error: 'not ready — complete the audit checklist and mark “ready to push” first' }, { status: 409 })
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
  const rawBuf = Buffer.from(await blob.arrayBuffer())

  // Shrink oversized scans (phone photos of check requests routinely arrive
  // multi-MB) so the PDF fits CINC's ~1 MB attachment limit. If we STILL
  // can't get the base64 payload under the ceiling, BLOCK the push here —
  // before any CINC invoice exists — so we never create a PDF-less invoice
  // (the bug that left CINC 16272 with no attachment). Karen can re-upload a
  // smaller/clearer scan and retry.
  const norm = await normalizePdf(rawBuf, { targetBytes: CINC_ATTACH_TARGET_BYTES }).catch(() => null)
  const buf  = norm?.buffer ?? rawBuf
  const pdfBase64 = buf.toString('base64')
  if (buf.length > CINC_ATTACH_MAX_BYTES) {
    return NextResponse.json({
      error: `Invoice PDF is ${(buf.length / 1024 / 1024).toFixed(2)} MB even after compression — over CINC's ~1 MB attachment limit. Replace it with a smaller / single-page scan and try again. Nothing was pushed to CINC.`,
      pdfTooLarge: true,
      normalizeNote: norm?.note ?? 'normalize returned nothing',
    }, { status: 413 })
  }

  // Cross-invoice double-pay guard. CINC's own duplicate check keys on the
  // invoice NUMBER; this catches what slipped through — the SAME vendor +
  // amount + association already pushed/queued under a DIFFERENT number
  // (e.g. "May" vs "May Compensation"). Hard-block, and only Karen may
  // override (pushAnyway) — staff can't push past a suspected double-pay.
  {
    const sinceIso = new Date(Date.now() - DUP_GUARD_DAYS * 86_400_000).toISOString()
    const { data: dupes } = await supabaseAdmin
      .from('invoice_intake_drafts')
      .select('id, cinc_invoice_id, extracted_invoice_number, status')
      .eq('matched_cinc_vendor_id', draft.matched_cinc_vendor_id as string)
      .eq('extracted_association_code', draft.extracted_association_code as string)
      .eq('extracted_amount', draft.extracted_amount as number)
      .in('status', ['pushed_to_cinc', 'ready_to_push'])
      .neq('id', id)
      .gte('created_at', sinceIso)
    if (dupes && dupes.length > 0) {
      const karenSet = new Set(trustedDomainVariants(KAREN_EMAIL).map(e => e.toLowerCase()))
      const isKaren  = karenSet.has((pushedBy ?? '').toLowerCase())
      if (!(body.pushAnyway && isKaren)) {
        const d0 = dupes[0]
        const tail = body.pushAnyway && !isKaren
          ? 'Only Karen can override a suspected double payment.'
          : 'If this really is a separate payment, Karen can push again with override.'
        return NextResponse.json({
          error: `Possible double payment: ${draft.matched_vendor_name ?? 'this vendor'} already has a $${(draft.extracted_amount as number).toFixed(2)} invoice for ${draft.extracted_association_code} in MAIA (draft ${d0.id}${d0.cinc_invoice_id ? `, CINC ${d0.cinc_invoice_id}` : ''}, #${d0.extracted_invoice_number ?? '—'}, ${d0.status}). ${tail}`,
          duplicateGuard: true,
          karenOnly: body.pushAnyway && !isKaren,
          existing: dupes.map(d => ({ id: d.id, cincInvoiceId: d.cinc_invoice_id, invoiceNumber: d.extracted_invoice_number, status: d.status })),
        }, { status: 409 })
      }
    }
  }

  // Push to CINC. createInvoice defaults StatusID to PENDING APPROVAL
  // (board approves in WebAxis afterward). Sends Karen's observation as
  // NoteDescription so the CINC team sees processing instructions when
  // they open the invoice. PayFromBankAccountID routes the payment to
  // the Operating / Reserve / Special Assessment bank account Karen
  // picked; null means "let CINC default to operating" (BankAccountID 0).
  const payFromBankAccountId = (draft.pay_from_bank_account_id ?? null) as number | null

  // Pay-by method: send ONLY what Karen explicitly picked on the draft.
  // We used to fall back to a DERIVED vendor default (ACH if Routing+Account
  // present, else Check) — but that guess didn't match the vendor's actual
  // Pay-By configured in CINC, so it pushed the WRONG method. Now we send
  // null when Karen didn't choose, and let CINC apply the vendor's own setup.
  const payByType = (draft.pay_by_type ?? null) as string | null

  // Shared invoice payload — reused if we have to retry with a different
  // pay method (see the ACH fallback below).
  const baseInvoice = {
    associationCode:      draft.extracted_association_code as string,
    vendorId:             parseInt(draft.matched_cinc_vendor_id as string, 10),
    invoiceNumber:        draft.extracted_invoice_number    as string,
    invoiceDate:          draft.extracted_invoice_date      as string,
    dueDate:              (draft.due_date ?? null) as string | null,
    amount:               draft.extracted_amount            as number,
    noteDescription:      (draft.observation_note ?? null) as string | null,
    workOrderNumber:      (draft.work_order_number ?? null) as number | null,
    payFromBankAccountId: payFromBankAccountId,
    vendorAccountNumber:  (draft.extracted_account_number ?? null) as string | null,
  }

  let cincInvoiceId: number
  // Surfaced to Karen when we had to fall back from ACH to Check.
  let payByWarning: string | null = null
  try {
    const created = await createInvoice({ ...baseInvoice, payByType })
    cincInvoiceId = created.invoiceId
  } catch (err) {
    const message = err instanceof CincApiError ? err.message : (err as Error).message
    // ACH was selected but the vendor has NO ACH banking set up in CINC, so
    // CINC 400s with "Selected Pay To cannot be paid via ACH, since it
    // doesn't have ACH Information setup." A 400 means nothing was created,
    // so it's safe to retry as Check — the only method CINC can use for this
    // vendor — and warn Karen (she can add the vendor's ACH in CINC if ACH
    // was truly intended; future invoices will then use it).
    const achUnavailable = /cannot be paid via ach|ach information/i.test(message)
    if (achUnavailable && (payByType ?? '').toUpperCase() === 'ACH') {
      try {
        const created = await createInvoice({ ...baseInvoice, payByType: 'Check' })
        cincInvoiceId = created.invoiceId
        payByWarning = `Pushed as Check, NOT ACH — this vendor has no ACH banking on file in CINC. To pay by ACH, add the vendor's routing + account in CINC; future invoices will then use ACH.`
        console.warn(`[invoice-push] ACH unavailable for vendor ${draft.matched_cinc_vendor_id}; pushed draft ${id} as Check`)
      } catch (err2) {
        const m2 = err2 instanceof CincApiError ? err2.message : (err2 as Error).message
        return NextResponse.json({ error: `CINC createInvoice failed: ACH was rejected (no ACH on file) and the Check retry also failed: ${m2}` }, { status: 502 })
      }
    } else {
      return NextResponse.json({ error: `CINC createInvoice failed: ${message}` }, { status: 502 })
    }
  }

  // Push the GL expense item Karen selected. Without this, the invoice
  // header lands in CINC but has no GL line — someone has to enter it
  // manually in CINC, defeating the point of having a GL dropdown in
  // the intake card.
  //
  // CINC's POST /accounting/expenseItems takes the formatted GL number
  // (e.g. "50-5000-00"), not the ChartID we store on the draft. So we
  // look up the budget (30-min cached) and find the line by ChartID
  // to get its GlNumber.
  //
  // Best-effort: if this fails, the invoice header still exists in
  // CINC and the PDF will still attach. The push response carries a
  // warning so Karen knows to fix it manually. Same pattern as the
  // PDF-attach failure path below.
  let expenseItemWarning: string | null = null
  let expenseItemCreated = false
  if (draft.gl_account_id) {
    try {
      const budget = await getAssociationBudget(draft.extracted_association_code as string)
      const glLine = budget.find(l => l.id === draft.gl_account_id)
      if (!glLine) {
        expenseItemWarning = `GL line ChartID ${draft.gl_account_id} not found in current budget for ${draft.extracted_association_code} — expense item not created. Add manually in CINC.`
        console.warn(`[invoice-push] ${expenseItemWarning}`)
      } else if (!glLine.number) {
        expenseItemWarning = `GL line "${glLine.name}" (ChartID ${glLine.id}) has no GLAccountNumber — CINC expense item creation requires it. Add manually in CINC.`
        console.warn(`[invoice-push] ${expenseItemWarning}`)
      } else {
        await createInvoiceExpenseItems({
          invoiceId: cincInvoiceId,
          items: [{
            glNumber:    glLine.number,
            description: (draft.gl_account_name as string) || glLine.name,
            amount:      draft.extracted_amount as number,
          }],
        })
        expenseItemCreated = true
      }
    } catch (err) {
      expenseItemWarning = `Expense item push failed: ${(err as Error).message}. Add the GL line manually in CINC.`
      console.warn(`[invoice-push] ${expenseItemWarning}`)
    }
  } else {
    expenseItemWarning = `No GL line selected on the draft — expense item not created. Add manually in CINC if needed.`
    console.warn(`[invoice-push] ${expenseItemWarning}`)
  }

  // Remove CINC's auto-created blank-GL placeholder line. createInvoice
  // always seeds the invoice with one expense line that has no GL and
  // equals the full total; left in place alongside our real GL line it
  // doubles the invoice ("Difference: ($X)"). We only prune it once our
  // real line exists — otherwise the blank line is the only allocation
  // and removing it would leave the invoice with none. Identify blanks by
  // an empty GLAccount and delete by their ID (CINC's DELETE model is
  // `{ InvoiceId, ExpenseItems: [<id>] }`). Best-effort.
  if (expenseItemCreated) {
    try {
      const inv = await getCincInvoice(cincInvoiceId)
      const blankIds = (inv?.ExpenseItems ?? [])
        .filter(it => it.ID != null && !((it.GLAccount ?? '').trim()))
        .map(it => it.ID as number)
      if (blankIds.length > 0) {
        await deleteInvoiceExpenseItems({ invoiceId: cincInvoiceId, expenseItemIds: blankIds })
      }
    } catch (err) {
      const msg = err instanceof CincApiError ? err.message : (err as Error).message
      expenseItemWarning = [expenseItemWarning, `Could not remove CINC's blank placeholder GL line: ${msg}. Delete the $0/blank line manually in CINC so the invoice total matches.`].filter(Boolean).join(' ')
      console.warn(`[invoice-push] blank-line cleanup failed: ${msg}`)
    }
  }

  // Attach PDF with the canonical rename.
  const filename = canonicalInvoiceFilename({
    association: draft.extracted_association_code as string,
    short:       draft.matched_vendor_short_name  ?? 'Vendor',
    invoiceNo:   draft.extracted_invoice_number   as string,
    amount:      draft.extracted_amount           as number,
  })
  // Attach the (already size-gated) PDF. The oversize case was blocked
  // before createInvoice, so this fits — a failure here is transient
  // (network/CINC). Surface it loudly: the invoice exists but has no PDF,
  // so Karen must re-attach via "Re-attach PDF to CINC" on the pushed card.
  let attachWarning: string | null = null
  try {
    await attachInvoicePdf({ invoiceId: cincInvoiceId, pdfBase64, filename })
  } catch (err) {
    const message = err instanceof CincApiError ? err.message : (err as Error).message
    attachWarning = `⚠ PDF was NOT attached in CINC: ${message}. The invoice exists in CINC — use "Re-attach PDF to CINC" on the pushed card to add it.`
    console.warn(`[invoice-push] ${attachWarning}`)
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
  let driveFileId: string | null = (draft.drive_file_id ?? null) as string | null
  let driveWarning: string | null = null
  if (!driveFileId) {
    // Not already mirrored at the Transfer-to-Push step — do it now.
    try {
      const mirror = await uploadInvoiceToDrive({ filename, pdfBuffer: buf })
      driveFileId = mirror.driveFileId
    } catch (err) {
      driveWarning = `Drive mirror failed: ${(err as Error).message}`
      console.warn(`[invoice-push] ${driveWarning}`)
    }
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

  // Learn the account-number route from this confirmed push, so the next
  // invoice on the same account auto-routes to this vendor + association + GL
  // (with the real GL ChartID, not just the seed's GL number). Best-effort.
  try {
    await recordAccountRoute({
      rawAccountNumber: (draft.extracted_account_number ?? null) as string | null,
      cincVendorId:     (draft.matched_cinc_vendor_id ?? null) as string | null,
      vendorName:       (draft.matched_vendor_name ?? null) as string | null,
      associationCode:  (draft.extracted_association_code ?? null) as string | null,
      glAccountId:      (draft.gl_account_id ?? null) as string | null,
      glAccountName:    (draft.gl_account_name ?? null) as string | null,
      payByType:        payByType,
      source:           'confirmed',
      confirmedBy:      pushedBy,
    })
  } catch (err) {
    console.warn(`[invoice-push] account-route learn failed: ${(err as Error).message}`)
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

  // Surface non-fatal warnings so Karen knows if any post-create step
  // didn't land. driveWarning + expenseItemWarning can both fire on the
  // same push; concatenate so we don't lose either.
  const warnings = [payByWarning, attachWarning, driveWarning, expenseItemWarning].filter(Boolean)
  if (warnings.length > 0) {
    return NextResponse.json({
      ok:       true,
      warning:  warnings.join(' · '),
      cincInvoiceId,
      driveFileId,
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
