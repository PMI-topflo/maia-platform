// =====================================================================
// lib/extract-pdf.ts
//
// Wraps pdf-parse with size + memory guards. PDFs uploaded through the
// /admin/associations/[code]/documents endpoint go through this helper
// inline (sync, blocking the upload response) so the extracted text is
// already in the DB by the time the page reloads.
//
// Rationale for inline rather than queue-and-poll:
//   - Almost all association docs are < 5 MB and parse in < 2 seconds.
//     With Vercel Fluid Compute's 300s default timeout, this fits.
//   - Inline = no second cron / worker to operate.
//   - For genuinely huge PDFs (>20 MB), we skip extraction and mark
//     extraction_status='skipped'. Staff can request a re-extract later.
// =====================================================================

const MAX_BYTES_FOR_EXTRACTION = 20 * 1024 * 1024  // 20 MB
const MAX_TEXT_BYTES_STORED     = 1_500_000        // ~1.5 MB of text per doc

export interface ExtractResult {
  status: 'done' | 'skipped' | 'failed'
  text:   string | null
  /** Number of pages we parsed — useful for UI ("128 pages indexed"). */
  pages:  number | null
  error:  string | null
}

export async function extractPdfText(buffer: Buffer, mimeType: string | null | undefined): Promise<ExtractResult> {
  if (!mimeType?.toLowerCase().includes('pdf')) {
    return { status: 'skipped', text: null, pages: null, error: 'Not a PDF' }
  }
  if (buffer.byteLength > MAX_BYTES_FOR_EXTRACTION) {
    return {
      status: 'skipped',
      text:   null,
      pages:  null,
      error:  `File is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB; extraction skipped (max ${MAX_BYTES_FOR_EXTRACTION / 1024 / 1024} MB)`,
    }
  }

  let parser: { destroy: () => Promise<void> } | null = null
  try {
    // pdf-parse v2.x exposes a PDFParse class wrapping pdfjs. Dynamic
    // import keeps it out of the cold-start bundle for routes that
    // don't extract. Buffer is auto-converted to Uint8Array internally.
    const { PDFParse } = await import('pdf-parse')
    const instance = new PDFParse({ data: buffer })
    parser = instance
    const result = await instance.getText()
    // result.text is the full concatenated document string; result.pages
    // is the per-page array (length = page count).
    const fullText = (result.text ?? '').trim()
    const pageCount = Array.isArray(result.pages) ? result.pages.length : null
    const truncated = fullText.length > MAX_TEXT_BYTES_STORED
      ? fullText.slice(0, MAX_TEXT_BYTES_STORED) + `\n\n[…truncated at ${MAX_TEXT_BYTES_STORED} chars…]`
      : fullText
    return {
      status: 'done',
      text:   truncated,
      pages:  pageCount,
      error:  null,
    }
  } catch (err) {
    return {
      status: 'failed',
      text:   null,
      pages:  null,
      error:  err instanceof Error ? err.message : String(err),
    }
  } finally {
    // PDFParse holds pdfjs worker references; release them so the
    // serverless function instance doesn't leak memory between requests.
    if (parser) await parser.destroy().catch(() => {})
  }
}
