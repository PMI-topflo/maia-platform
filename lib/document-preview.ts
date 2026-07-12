// =====================================================================
// lib/document-preview.ts
//
// Render a stored document (Supabase Storage URL -- an applicant upload,
// or the Checkr report mirror) as inline images instead of a downloadable
// PDF, for the staff Applications dashboard and the board review page.
// Images pass through as-is; PDFs are rasterised to one JPEG per page
// (same approach as lib/estimate-preview.ts uses for vendor estimates).
//
// Only ever fetches from our own Supabase Storage host -- never an
// arbitrary caller-supplied URL -- since the fetch happens server-side.
// =====================================================================

import { renderPdfToImageDataUrls } from '@/lib/pdf-normalize'

const SUPABASE_HOST_PREFIX = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

export function isAllowedStorageUrl(url: string): boolean {
  if (!SUPABASE_HOST_PREFIX || !url) return false
  return url.startsWith(`${SUPABASE_HOST_PREFIX}/storage/`)
}

/** Fetches `url` and returns it as one or more inline-renderable images.
 *  Images pass through as the same URL (the browser loads it directly);
 *  PDFs are rasterised. Returns [] on any failure or disallowed host. */
export async function urlToPreviewPages(url: string): Promise<string[]> {
  if (!isAllowedStorageUrl(url)) return []
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const contentType = res.headers.get('content-type') ?? ''
    const buf = Buffer.from(await res.arrayBuffer())
    const isPdf = contentType.includes('pdf') || buf.subarray(0, 5).toString('latin1') === '%PDF-'
    if (isPdf) return renderPdfToImageDataUrls(buf, { maxPages: 12 })
    // Not a PDF -- already a directly-renderable image, hand back the URL.
    return [url]
  } catch {
    return []
  }
}
