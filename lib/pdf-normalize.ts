// =====================================================================
// lib/pdf-normalize.ts
//
// Shrink oversized invoice PDFs to a sane size BEFORE they're stored,
// pushed to CINC, or mirrored to Drive.
//
// Why: invoices arrive as phone-camera scans — a single 22 MB PDF that
// wraps a few enormous JPEGs. CINC rejects attachments over ~1 MB with a
// cryptic 400, and a 22 MB file is wasteful everywhere else too. We
// normalize once, at intake, so every downstream copy (storage / CINC /
// Drive) is the small version.
//
// How: rasterize each page with pdf.js onto a @napi-rs/canvas, recompress
// to JPEG with sharp (resized + quality-capped), then re-wrap the JPEGs
// into a fresh PDF with pdf-lib. If the result is still too big, step the
// scale + quality down and try again.
//
// This is BEST-EFFORT and self-contained: any failure (parse error, a
// real text PDF we shouldn't rasterize, a missing native dep at runtime)
// returns the ORIGINAL buffer untouched. Callers must never depend on the
// output being smaller — only treat it as "smaller if we could".
//
// NOTE: rasterizing flattens text/vectors into an image, so we ONLY touch
// files that are already over the size budget. Small, well-formed text
// PDFs (the common e-invoice case) pass through unchanged.
// =====================================================================

import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'

// CINC's real invoice-attachment ceiling is ~1 MB. Aim a little under so
// base64 expansion (+33%) and PDF container overhead still clear it.
export const PDF_TARGET_BYTES = 900_000

export interface NormalizeResult {
  /** The normalized bytes, or the original if we left it alone / failed. */
  buffer: Buffer
  /** True only if we actually produced a smaller re-encoded PDF. */
  changed: boolean
  /** Original size in bytes. */
  originalBytes: number
  /** Final size in bytes (== originalBytes when unchanged). */
  finalBytes: number
  /** Human-readable note for logs / warnings. */
  note: string
}

// Progressive passes: longest-side pixel cap + JPEG quality. First pass
// keeps decent resolution; later passes trade fidelity for size. ~1654px
// ≈ 200 DPI on US-Letter, which stays legible for a check-request scan.
const PASSES: ReadonlyArray<{ maxPx: number; quality: number }> = [
  { maxPx: 1654, quality: 70 },
  { maxPx: 1240, quality: 60 },
  { maxPx: 1000, quality: 50 },
]

// pdf.js is ESM + Node-flavoured; import the legacy build lazily so a
// load failure degrades to "leave the PDF alone" instead of crashing the
// module graph at import time.
async function loadPdfjs() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

/**
 * Rasterize a PDF buffer to one JPEG per page at the given pixel cap.
 * Returns the JPEGs with their pixel dimensions.
 */
async function rasterizeToJpegs(
  buf: Buffer,
  maxPx: number,
  quality: number,
): Promise<Array<{ jpeg: Buffer; width: number; height: number }>> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const pdfjs = await loadPdfjs()

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    // No worker thread in a serverless function; render on the main thread.
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise

  const pages: Array<{ jpeg: Buffer; width: number; height: number }> = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const longest = Math.max(base.width, base.height)
      const scale = longest > maxPx ? maxPx / longest : 1
      const viewport = page.getViewport({ scale })

      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      // White background — scans assume opaque paper, not transparency.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)

      await page.render({
        // @napi-rs/canvas's 2D context is API-compatible with pdf.js.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        canvasContext: ctx as any,
        viewport,
      }).promise

      const png = canvas.toBuffer('image/png')
      const jpeg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer()
      pages.push({ jpeg, width, height })
      page.cleanup()
    }
  } finally {
    await doc.cleanup?.()
    await doc.destroy?.()
  }
  return pages
}

/** Re-wrap rasterized JPEG pages into a fresh PDF. */
async function jpegsToPdf(
  pages: Array<{ jpeg: Buffer; width: number; height: number }>,
): Promise<Buffer> {
  const out = await PDFDocument.create()
  for (const p of pages) {
    const img = await out.embedJpg(p.jpeg)
    const page = out.addPage([p.width, p.height])
    page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height })
  }
  const bytes = await out.save()
  return Buffer.from(bytes)
}

/**
 * Normalize a PDF to <= targetBytes when it exceeds the budget. Returns
 * the original buffer untouched if it's already small enough, if it's not
 * a PDF, or if anything in the pipeline fails.
 */
export async function normalizePdf(
  buf: Buffer,
  opts: { targetBytes?: number } = {},
): Promise<NormalizeResult> {
  const targetBytes = opts.targetBytes ?? PDF_TARGET_BYTES
  const originalBytes = buf.length

  // Only re-encode oversized files (rasterizing degrades real text PDFs).
  if (originalBytes <= targetBytes) {
    return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: 'already within size budget' }
  }
  // Cheap sniff: PDFs start with "%PDF". Anything else, leave alone.
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: 'not a PDF — left unchanged' }
  }

  let best: Buffer | null = null
  try {
    for (const pass of PASSES) {
      const pages = await rasterizeToJpegs(buf, pass.maxPx, pass.quality)
      if (pages.length === 0) break
      const candidate = await jpegsToPdf(pages)
      if (!best || candidate.length < best.length) best = candidate
      if (candidate.length <= targetBytes) {
        return {
          buffer: candidate, changed: true, originalBytes, finalBytes: candidate.length,
          note: `compressed ${(originalBytes / 1e6).toFixed(1)}MB → ${(candidate.length / 1e6).toFixed(2)}MB (${pass.maxPx}px q${pass.quality})`,
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // If an earlier pass produced something smaller, still use it.
    if (best && best.length < originalBytes) {
      return {
        buffer: best, changed: true, originalBytes, finalBytes: best.length,
        note: `partial compression to ${(best.length / 1e6).toFixed(2)}MB; pipeline stopped: ${msg}`,
      }
    }
    return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: `normalize failed, kept original: ${msg}` }
  }

  // Ran every pass; use the smallest we got even if still over target.
  if (best && best.length < originalBytes) {
    return {
      buffer: best, changed: true, originalBytes, finalBytes: best.length,
      note: `compressed to ${(best.length / 1e6).toFixed(2)}MB (still over ${(targetBytes / 1e6).toFixed(1)}MB target after all passes)`,
    }
  }
  return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: 'could not reduce below original; kept original' }
}
