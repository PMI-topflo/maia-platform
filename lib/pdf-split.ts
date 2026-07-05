// =====================================================================
// lib/pdf-split.ts
// Page-count helper for the Document Inbox intake pipeline (used to decide
// which model tier classifies a document). Best-effort: returns 1 on any
// failure so the caller can proceed with the full file.
// =====================================================================

import { PDFDocument } from 'pdf-lib'

export async function pdfPageCount(buf: Buffer): Promise<number> {
  try {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return 1
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
    return doc.getPageCount() || 1
  } catch { return 1 }
}
