// POST /api/admin/payment-reconciliation/checkr-receipts   multipart: files[] (PDF receipts or a ZIP of them)
// Reads each Checkr receipt, stores it by order id, reports matched / unmatched. Staff-only.
// Receipts are ~50 KB each; a month's ZIP stays far below the 4 MB body cap
// enforced here (larger uploads go through signed Storage URLs elsewhere).
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { extractPdfText } from '@/lib/extract-pdf'
import { parseCheckrReceipt, storeCheckrReceipt, pdfTextViaPdfjs } from '@/lib/payment-reconciliation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
const MAX_BYTES = 4 * 1024 * 1024

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Send the receipts as files' }, { status: 400 })
  const files = form.getAll('files').filter((f): f is File => typeof f === 'object' && 'arrayBuffer' in f)
  if (!files.length) return NextResponse.json({ error: 'No files received' }, { status: 400 })

  const pdfs: { name: string; buf: Buffer }[] = []
  let total = 0
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer()); total += buf.length
    if (total > MAX_BYTES) return NextResponse.json({ error: 'Too large — upload at most 4 MB at a time (one month of receipts fits easily).' }, { status: 413 })
    if (/\.zip$/i.test(f.name) || buf.subarray(0, 2).toString('latin1') === 'PK') {
      const zip = await JSZip.loadAsync(buf)
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir || !/\.pdf$/i.test(name) || /__MACOSX|\/\./.test(name)) continue
        pdfs.push({ name: name.split('/').pop() ?? name, buf: Buffer.from(await entry.async('nodebuffer')) })
      }
    } else pdfs.push({ name: f.name, buf })
  }

  const by = staffLabel(session)
  const result = { read: 0, new: 0, updated: 0, matched: [] as string[], unmatched: [] as string[], skipped: [] as string[] }
  for (const p of pdfs) {
    try {
      let text = (await extractPdfText(p.buf, 'application/pdf')).text ?? ''
      let fallbackErr: string | null = null
      if (!/AMOUNT PAID/i.test(text)) {
        try { const t2 = await pdfTextViaPdfjs(p.buf); if (t2.length > text.length) text = t2 } catch (e) { fallbackErr = e instanceof Error ? e.message : String(e) }
      }
      const parsed = parseCheckrReceipt(text, p.name)
      if (!parsed) { result.skipped.push(`${p.name} (no order id in the text or the file name${fallbackErr ? `; pdf.js: ${fallbackErr}` : ''}; text starts "${text.slice(0, 80).replace(/\s+/g, ' ')}")`); continue }
      if (!parsed.amountCents) { result.skipped.push(`${p.name} (order ${parsed.orderId}: no amount found${fallbackErr ? `; pdf.js: ${fallbackErr}` : ''}; text starts "${text.slice(0, 80).replace(/\s+/g, ' ')}")`); continue }
      result.read++
      const m = await storeCheckrReceipt(parsed, p.name, by)
      if (m.existed) result.updated++; else result.new++
      ;(m.match === 'matched' ? result.matched : result.unmatched).push(`${parsed.orderId} · ${parsed.applicantName ?? '?'} · $${(parsed.amountCents / 100).toFixed(2)}${m.existed ? ' (already on file)' : ''}`)
    } catch (e) { result.skipped.push(`${p.name} (${e instanceof Error ? e.message : String(e)})`) }
  }
  return NextResponse.json(result)
}
