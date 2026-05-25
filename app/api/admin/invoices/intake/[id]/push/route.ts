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
  CincApiError,
} from '@/lib/integrations/cinc'

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
    .select('id, status, pdf_storage_key, matched_cinc_vendor_id, matched_vendor_short_name, extracted_invoice_number, extracted_amount, extracted_association_code, extracted_invoice_date')
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

  // Push to CINC.
  let cincInvoiceId: number
  try {
    const created = await createInvoice({
      associationCode: draft.extracted_association_code as string,
      vendorId:        parseInt(draft.matched_cinc_vendor_id as string, 10),
      invoiceNumber:   draft.extracted_invoice_number as string,
      invoiceDate:     draft.extracted_invoice_date as string,
      amount:          draft.extracted_amount as number,
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

  // Mark pushed.
  const { error: updErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .update({
      status:          'pushed_to_cinc',
      cinc_invoice_id: String(cincInvoiceId),
      pushed_at:       new Date().toISOString(),
      pushed_by:       pushedBy,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', id)
  if (updErr) {
    return NextResponse.json({
      warning: `Pushed to CINC (id ${cincInvoiceId}) but failed to update draft state: ${updErr.message}`,
      cincInvoiceId,
    }, { status: 207 })
  }

  return NextResponse.json({ ok: true, cincInvoiceId })
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
