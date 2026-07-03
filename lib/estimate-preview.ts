// =====================================================================
// lib/estimate-preview.ts
//
// Render a vendor's uploaded estimate (an estimate_request_vendors row) to
// inline images so it can be shown side-by-side in the board comparison and
// the staff comparison panel without a download. Images pass through as a
// signed URL; PDFs are rasterised to one JPEG per page.
//
// Shared by /api/board/estimate/preview (token-gated) and
// /api/admin/work-orders/[id]/estimate-preview (staff session-gated).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { renderPdfToImageDataUrls } from '@/lib/pdf-normalize'

const BUCKET = 'work-order-photos'

/** Inline-renderable pages for one vendor's estimate. Empty if none on file. */
export async function estimatePagesForErv(ervId: string | null, opts: { maxPages?: number } = {}): Promise<string[]> {
  if (!ervId) return []
  const { data: erv } = await supabaseAdmin.from('estimate_request_vendors').select('estimate_path').eq('id', ervId).maybeSingle()
  if (!erv?.estimate_path) return []
  const { data: att } = await supabaseAdmin.from('work_order_attachments').select('storage_path, mime_type').eq('id', erv.estimate_path).maybeSingle()
  if (!att?.storage_path) return []

  // Image estimate → hand back a signed URL directly.
  if ((att.mime_type ?? '').startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(att.storage_path as string)) {
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(att.storage_path as string, 3600)
    return signed?.signedUrl ? [signed.signedUrl] : []
  }

  // PDF → rasterise to JPEG pages.
  const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(att.storage_path as string)
  if (error || !blob) return []
  return renderPdfToImageDataUrls(Buffer.from(await blob.arrayBuffer()), { maxPages: opts.maxPages ?? 8 })
}

/** True if `ervId` belongs to `requestId` — an authorization guard so a token
 *  scoped to one approval can only preview vendors from that same RFQ. */
export async function ervBelongsToRequest(ervId: string, requestId: string | null): Promise<boolean> {
  if (!ervId || !requestId) return false
  const { data } = await supabaseAdmin.from('estimate_request_vendors').select('id').eq('id', ervId).eq('request_id', requestId).maybeSingle()
  return !!data
}
