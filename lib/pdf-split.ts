// =====================================================================
// lib/pdf-split.ts
// Split a bundled PDF (e.g. an ACORD insurance packet) into per-policy
// files by page range, for the Compliance Hub document intake. Best-effort:
// returns null on any failure so the caller can fall back to the full file.
// =====================================================================

import { PDFDocument } from 'pdf-lib'

export async function pdfPageCount(buf: Buffer): Promise<number> {
  try {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return 1
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
    return doc.getPageCount() || 1
  } catch { return 1 }
}

/** Extract pages [start..end] (1-based, inclusive) into a new PDF. Returns
 *  null if the range is invalid or the PDF can't be processed. */
export async function splitPdfRange(buf: Buffer, start: number, end: number): Promise<Buffer | null> {
  try {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true })
    const total = src.getPageCount()
    const s = Math.max(1, Math.min(start, total))
    const e = Math.max(s, Math.min(end, total))
    const out = await PDFDocument.create()
    const idx: number[] = []
    for (let i = s; i <= e; i++) idx.push(i - 1)
    const pages = await out.copyPages(src, idx)
    pages.forEach(p => out.addPage(p))
    return Buffer.from(await out.save())
  } catch { return null }
}
