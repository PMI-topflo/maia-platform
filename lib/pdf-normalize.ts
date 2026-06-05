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

// Generic document uploads (condo docs, leases, COI, financials) don't go
// to CINC, so they get a roomier budget — we only want to tame 20 MB phone
// scans, not touch ordinary multi-page text PDFs.
export const DOC_TARGET_BYTES = 4_000_000

// Image uploads (work-order photos, scanned COIs saved as JPG/PNG).
export const IMAGE_TARGET_BYTES = 1_500_000
const IMAGE_MAX_DIM = 2400

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
 * True if the PDF carries a real, selectable text layer (a born-digital
 * document) rather than being a flat scan. We sample the first few pages
 * and call it "text" if there's a meaningful amount of extractable text.
 *
 * This protects ordinary documents (leases, financials, board PDFs) from
 * being rasterized — flattening them would destroy the text layer and
 * wreck downstream text extraction. Scans (phone photos of a check
 * request) have ~no text and fall through to compression.
 *
 * Conservative on failure: returns true ("looks like text, leave it") so
 * an unparseable PDF is never rasterized blindly.
 */
async function pdfHasTextLayer(buf: Buffer): Promise<boolean> {
  try {
    const pdfjs = await loadPdfjs()
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise
    try {
      const sample = Math.min(doc.numPages, 3)
      let chars = 0
      for (let i = 1; i <= sample; i++) {
        const page = await doc.getPage(i)
        const tc = await page.getTextContent()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chars += tc.items.map((it: any) => ('str' in it ? it.str : '')).join('').length
        page.cleanup()
      }
      // > ~300 chars/page of real text => a born-digital document.
      return chars / sample > 300
    } finally {
      await doc.cleanup?.()
      await doc.destroy?.()
    }
  } catch {
    return true
  }
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
 * Wrap a single image (JPG/PNG/HEIC/WebP/…) into a one-page PDF, downscaled
 * and JPEG-recompressed so the result is small enough for storage + the CINC
 * attach (~1 MB cap). Used by invoice intake when a vendor sends an invoice
 * as a photo/scan instead of a PDF. Throws if the bytes aren't a readable image.
 */
export async function imageToPdf(buf: Buffer, opts: { maxDim?: number; quality?: number } = {}): Promise<Buffer> {
  const maxDim  = opts.maxDim  ?? IMAGE_MAX_DIM
  const quality = opts.quality ?? 78
  const pipe = sharp(buf).rotate()   // bake in EXIF orientation
  const meta = await pipe.metadata()
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
  const resized = longest > maxDim
    ? pipe.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    : pipe
  const jpeg = await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
  const dims = await sharp(jpeg).metadata()
  return jpegsToPdf([{ jpeg, width: dims.width ?? 1000, height: dims.height ?? 1000 }])
}

/**
 * Normalize a PDF to <= targetBytes when it exceeds the budget. Returns
 * the original buffer untouched if it's already small enough, if it's not
 * a PDF, or if anything in the pipeline fails.
 */
export async function normalizePdf(
  buf: Buffer,
  opts: { targetBytes?: number; preserveTextPdfs?: boolean } = {},
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
  // Don't flatten born-digital text PDFs (leases, financials, board docs).
  if (opts.preserveTextPdfs !== false && await pdfHasTextLayer(buf)) {
    return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: 'text-layer PDF preserved (not rasterized)' }
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

/**
 * Shrink an oversized raster image (work-order photo, scanned COI saved as
 * JPG/PNG). Resizes the longest side down to IMAGE_MAX_DIM and recompresses
 * IN THE SAME FORMAT so the file extension / contentType / DB mime stay
 * valid. Best-effort: returns the original on any failure, for animated
 * images, or if re-encoding didn't actually save bytes.
 */
export async function normalizeImage(
  buf: Buffer,
  opts: { targetBytes?: number } = {},
): Promise<NormalizeResult> {
  const targetBytes = opts.targetBytes ?? IMAGE_TARGET_BYTES
  const originalBytes = buf.length
  if (originalBytes <= targetBytes) {
    return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: 'image already within size budget' }
  }
  try {
    const meta = await sharp(buf).metadata()
    // Don't touch animated images (GIF/animated WebP) — recompressing
    // would drop frames.
    if ((meta.pages ?? 1) > 1) {
      return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: 'animated image left unchanged' }
    }
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
    let pipe = sharp(buf).rotate() // bake in EXIF orientation
    if (longest > IMAGE_MAX_DIM) pipe = pipe.resize({ width: IMAGE_MAX_DIM, height: IMAGE_MAX_DIM, fit: 'inside', withoutEnlargement: true })

    let out: Buffer
    switch (meta.format) {
      case 'jpeg': out = await pipe.jpeg({ quality: 72, mozjpeg: true }).toBuffer(); break
      case 'png':  out = await pipe.png({ compressionLevel: 9, palette: true }).toBuffer(); break
      case 'webp': out = await pipe.webp({ quality: 72 }).toBuffer(); break
      default:
        return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: `image format ${meta.format ?? '?'} left unchanged` }
    }
    if (out.length >= originalBytes) {
      return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: 'recompression did not shrink image; kept original' }
    }
    return {
      buffer: out, changed: true, originalBytes, finalBytes: out.length,
      note: `image ${(originalBytes / 1e6).toFixed(1)}MB → ${(out.length / 1e6).toFixed(2)}MB`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { buffer: buf, changed: false, originalBytes, finalBytes: originalBytes, note: `image normalize failed, kept original: ${msg}` }
  }
}

/**
 * One entry point for ALL file uploads in the system. Dispatches on type:
 *   - PDF   → normalizePdf (rasterize scans; born-digital text PDFs are
 *             preserved)
 *   - image → normalizeImage (resize + recompress, same format)
 *   - other → returned untouched
 *
 * The returned buffer is safe to store under the SAME filename /
 * contentType the caller already chose (PDF stays a PDF, image keeps its
 * format). Always succeeds — falls back to the original bytes.
 */
export async function normalizeUpload(
  buf: Buffer,
  opts: { contentType?: string | null; filename?: string | null; pdfTargetBytes?: number; imageTargetBytes?: number } = {},
): Promise<NormalizeResult> {
  const ct = (opts.contentType ?? '').toLowerCase()
  const name = (opts.filename ?? '').toLowerCase()
  const isPdf = ct.includes('pdf') || name.endsWith('.pdf') || buf.subarray(0, 5).toString('latin1') === '%PDF-'
  if (isPdf) {
    return normalizePdf(buf, { targetBytes: opts.pdfTargetBytes ?? DOC_TARGET_BYTES })
  }
  const isImage = ct.startsWith('image/') || /\.(jpe?g|png|webp)$/.test(name)
  if (isImage) {
    return normalizeImage(buf, { targetBytes: opts.imageTargetBytes })
  }
  return { buffer: buf, changed: false, originalBytes: buf.length, finalBytes: buf.length, note: 'unsupported type — left unchanged' }
}
