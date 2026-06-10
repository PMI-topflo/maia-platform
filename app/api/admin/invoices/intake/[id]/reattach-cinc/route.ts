// =====================================================================
// app/api/admin/invoices/intake/[id]/reattach-cinc/route.ts
// POST — (re)attach a pushed invoice's PDF to its existing CINC invoice.
//
// For invoices that landed in CINC without their PDF (e.g. an oversized
// scan that the old push silently skipped, like CINC 16272). Downloads
// the stored PDF, shrinks it to fit CINC's ~1 MB limit, and attaches it
// to the already-created cinc_invoice_id. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { attachInvoicePdf, CincApiError } from '@/lib/integrations/cinc'
import { normalizePdf } from '@/lib/pdf-normalize'

export const dynamic = 'force-dynamic'

const STORAGE_BUCKET = 'invoice-intake-pdfs'
const CINC_ATTACH_TARGET_BYTES = 700_000      // normalize target (keeps uploads fast)
const CINC_ATTACH_MAX_BYTES    = 1_000_000    // hard refusal — CINC's ~1 MB FILE limit (gate on file size, not base64)

function canonicalInvoiceFilename(o: { association: string; short: string; invoiceNo: string; amount: number }): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  const amt  = o.amount.toFixed(2).replace(/\.00$/, '')
  return `${safe(o.association)}_${safe(o.short)}_${safe(o.invoiceNo)}_$${amt}.pdf`
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const { data: draft, error: loadErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, status, cinc_invoice_id, pdf_storage_key, extracted_association_code, matched_vendor_short_name, extracted_invoice_number, extracted_amount')
    .eq('id', id)
    .single()
  if (loadErr || !draft) return NextResponse.json({ error: loadErr?.message ?? 'not found' }, { status: 404 })
  if (!draft.cinc_invoice_id) return NextResponse.json({ error: 'this draft has no CINC invoice id — push it first' }, { status: 400 })
  if (!draft.pdf_storage_key) return NextResponse.json({ error: 'no stored PDF for this draft' }, { status: 400 })

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(draft.pdf_storage_key as string)
  if (dlErr || !blob) return NextResponse.json({ error: `storage download failed: ${dlErr?.message ?? 'no blob'}` }, { status: 500 })

  const rawBuf = Buffer.from(await blob.arrayBuffer())
  const norm   = await normalizePdf(rawBuf, { targetBytes: CINC_ATTACH_TARGET_BYTES, preserveTextPdfs: false }).catch(() => null)
  const buf    = norm?.buffer ?? rawBuf
  const pdfBase64 = buf.toString('base64')
  if (buf.length > CINC_ATTACH_MAX_BYTES) {
    return NextResponse.json({ error: `PDF is ${(buf.length / 1024 / 1024).toFixed(2)} MB even after compression — over CINC's ~1 MB attachment limit. Replace it with a smaller scan.`, pdfTooLarge: true, normalizeNote: norm?.note ?? 'normalize returned nothing' }, { status: 413 })
  }

  const filename = canonicalInvoiceFilename({
    association: draft.extracted_association_code as string,
    short:       draft.matched_vendor_short_name ?? 'Vendor',
    invoiceNo:   draft.extracted_invoice_number as string,
    amount:      draft.extracted_amount as number,
  })

  try {
    await attachInvoicePdf({ invoiceId: parseInt(draft.cinc_invoice_id as string, 10), pdfBase64, filename })
  } catch (err) {
    const message = err instanceof CincApiError ? err.message : (err as Error).message
    return NextResponse.json({ error: `CINC attach failed: ${message}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true, cincInvoiceId: draft.cinc_invoice_id, filename })
}
