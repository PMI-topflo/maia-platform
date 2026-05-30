// =====================================================================
// lib/normalize-upload-client.ts
//
// BROWSER-side upload normalizer — the client-side twin of
// lib/pdf-normalize.ts.
//
// Some uploads (board/condo docs, insurance COI, safety reports,
// work-order photos, the tenant application form) PUT the file straight
// to Supabase via a signed URL, so the server never sees the bytes and
// can't shrink them. This util compresses the File IN THE BROWSER before
// it's sent, mirroring the server budgets/behaviour:
//   - images → resize (longest side ≤ 2400px) + recompress, same format
//   - PDFs   → rasterize scans to JPEG pages + re-wrap; born-digital text
//              PDFs are left untouched
//
// Native canvas does the image work; pdf.js + pdf-lib are dynamically
// imported ONLY when a large PDF actually needs work, so they stay out of
// the initial bundle. Always best-effort: any failure returns the
// ORIGINAL File, so an upload can never break because of this.
//
// Browser-only — do not import from server code.
// =====================================================================

const PDF_TARGET_BYTES = 4_000_000
const IMAGE_TARGET_BYTES = 1_500_000
const MAX_DIM = 2400

/** Compress a user-selected File before upload. Returns a new File (same
 *  name + type) when it shrank, or the original File otherwise. */
export async function normalizeUploadFile(file: File): Promise<File> {
  try {
    const type = (file.type || '').toLowerCase()
    const name = (file.name || '').toLowerCase()
    const isPdf = type.includes('pdf') || name.endsWith('.pdf')
    const isImage = type.startsWith('image/') || /\.(jpe?g|png|webp)$/.test(name)

    if (isPdf && file.size > PDF_TARGET_BYTES) return await normalizePdfFile(file)
    if (isImage && file.size > IMAGE_TARGET_BYTES) return await normalizeImageFile(file)
    return file
  } catch {
    return file
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

async function normalizeImageFile(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  try {
    let { width, height } = bitmap
    const longest = Math.max(width, height)
    if (longest > MAX_DIM) {
      const scale = MAX_DIM / longest
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)

    // Recompress in the same broad format so the extension / contentType
    // the caller sends stays valid. PNG stays lossless (resize is the win).
    const outType = file.type.startsWith('image/') ? file.type : 'image/jpeg'
    const quality = outType === 'image/png' ? undefined : 0.72
    const blob = await canvasToBlob(canvas, outType, quality)
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name, { type: outType, lastModified: file.lastModified })
  } finally {
    bitmap.close?.()
  }
}

// Lazily load + configure pdf.js for the browser (worker bundled via the
// asset-URL pattern Turbopack/webpack both understand).
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  }
  return pdfjs
}

const PASSES: ReadonlyArray<{ maxPx: number; quality: number }> = [
  { maxPx: 1654, quality: 0.7 },
  { maxPx: 1240, quality: 0.6 },
  { maxPx: 1000, quality: 0.5 },
]

async function normalizePdfFile(file: File): Promise<File> {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdfjs = await loadPdfjs()

  // Don't flatten born-digital text PDFs (leases, financials, board docs).
  {
    const probe = await pdfjs.getDocument({ data: data.slice() }).promise
    try {
      const sample = Math.min(probe.numPages, 3)
      let chars = 0
      for (let i = 1; i <= sample; i++) {
        const page = await probe.getPage(i)
        const tc = await page.getTextContent()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chars += tc.items.map((it: any) => ('str' in it ? it.str : '')).join('').length
        page.cleanup()
      }
      if (chars / sample > 300) return file // text PDF — leave it alone
    } finally {
      await probe.destroy()
    }
  }

  const { PDFDocument } = await import('pdf-lib')

  let best: Blob | null = null
  for (const pass of PASSES) {
    const out = await PDFDocument.create()
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const base = page.getViewport({ scale: 1 })
        const longest = Math.max(base.width, base.height)
        const scale = longest > pass.maxPx ? pass.maxPx / longest : 1
        const viewport = page.getViewport({ scale })
        const width = Math.max(1, Math.ceil(viewport.width))
        const height = Math.max(1, Math.ceil(viewport.height))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return file
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.render({ canvasContext: ctx as any, viewport, canvas }).promise

        const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', pass.quality)
        page.cleanup()
        if (!jpegBlob) continue
        const img = await out.embedJpg(new Uint8Array(await jpegBlob.arrayBuffer()))
        const pg = out.addPage([width, height])
        pg.drawImage(img, { x: 0, y: 0, width, height })
      }
    } finally {
      await doc.destroy()
    }

    const bytes = await out.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    if (!best || blob.size < best.size) best = blob
    if (blob.size <= PDF_TARGET_BYTES) break
  }

  if (best && best.size < file.size) {
    return new File([best], file.name, { type: 'application/pdf', lastModified: file.lastModified })
  }
  return file
}
