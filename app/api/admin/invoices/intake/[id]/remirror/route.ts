// =====================================================================
// app/api/admin/invoices/intake/[id]/remirror/route.ts
// POST — re-mirror a PUSHED invoice's PDF to the INVOICE TO INPUT Drive
// folder, for the case where the Drive copy missed during the original
// push (a transient Drive failure is non-fatal there). Idempotent-ish:
// only runs for already-pushed drafts, downloads the same stored PDF and
// uploads it under the canonical filename, then records drive_file_id.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { uploadInvoiceToDrive } from '@/lib/drive-invoice-mirror'
import { normalizePdf } from '@/lib/pdf-normalize'

export const dynamic = 'force-dynamic'
const STORAGE_BUCKET = 'invoice-intake-pdfs'

function canonicalInvoiceFilename(opts: { association: string; short: string; invoiceNo: string; amount: number }): string {
  const safe = (s: string) => (s ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  const amt  = (Number.isFinite(opts.amount) ? opts.amount : 0).toFixed(2).replace(/\.00$/, '')
  return `${safe(opts.association) || 'ASSOC'}_${safe(opts.short) || 'Vendor'}_${safe(opts.invoiceNo) || 'INV'}_$${amt}.pdf`
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const { data: draft, error } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, status, pdf_storage_key, drive_file_id, extracted_association_code, matched_vendor_short_name, extracted_invoice_number, extracted_amount')
    .eq('id', id)
    .single()
  if (error || !draft) return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 })
  if (draft.status !== 'pushed_to_cinc') {
    return NextResponse.json({ error: 'Only a pushed invoice can be re-mirrored to Drive.' }, { status: 409 })
  }
  if (!draft.pdf_storage_key) {
    return NextResponse.json({ error: 'No stored PDF for this invoice to mirror.' }, { status: 400 })
  }

  const { data: blob, error: dlErr } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .download(draft.pdf_storage_key as string)
  if (dlErr || !blob) return NextResponse.json({ error: `storage download failed: ${dlErr?.message ?? 'no blob'}` }, { status: 500 })
  const rawBuf = Buffer.from(await blob.arrayBuffer())
  // Compress before mirroring so the Drive copy isn't a 20 MB raw scan (the
  // stored PDF may be raw if it predates the working compressor).
  const norm = await normalizePdf(rawBuf).catch(() => null)
  const buf  = norm?.buffer ?? rawBuf

  const filename = canonicalInvoiceFilename({
    association: draft.extracted_association_code as string,
    short:       (draft.matched_vendor_short_name as string) ?? 'Vendor',
    invoiceNo:   draft.extracted_invoice_number as string,
    amount:      draft.extracted_amount as number,
  })

  try {
    const mirror = await uploadInvoiceToDrive({ filename, pdfBuffer: buf })
    await supabaseAdmin
      .from('invoice_intake_drafts')
      .update({ drive_file_id: mirror.driveFileId, updated_at: new Date().toISOString() })
      .eq('id', id)
    return NextResponse.json({ ok: true, driveFileId: mirror.driveFileId, webViewLink: mirror.webViewLink, filename, compressor: norm?.note ?? 'no compression run', sizeMB: +(buf.length / 1e6).toFixed(2) })
  } catch (err) {
    return NextResponse.json({ error: `Drive upload failed: ${(err as Error).message}` }, { status: 502 })
  }
}
