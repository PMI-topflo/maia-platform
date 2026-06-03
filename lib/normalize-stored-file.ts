// =====================================================================
// lib/normalize-stored-file.ts
//
// Normalize (compress) a file that was uploaded DIRECTLY to Supabase
// Storage by the browser via a signed upload URL — the one upload path
// where the server never sees the bytes, so it can't run normalizeUpload
// inline. Call this from the "upload complete" / metadata-record handler:
// it downloads the just-uploaded object, runs it through normalizeUpload,
// and overwrites it in place ONLY if it actually shrank.
//
// Best-effort: any failure leaves the original object untouched. Returns a
// note for logging so a silent no-op is visible.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeUpload } from '@/lib/pdf-normalize'

export async function normalizeStoredFile(opts: {
  bucket:            string
  path:              string
  contentType?:      string | null
  filename?:         string | null
  pdfTargetBytes?:   number
  imageTargetBytes?: number
}): Promise<{ changed: boolean; originalBytes: number; finalBytes: number; note: string }> {
  try {
    const { data: blob, error } = await supabaseAdmin.storage.from(opts.bucket).download(opts.path)
    if (error || !blob) return { changed: false, originalBytes: 0, finalBytes: 0, note: `download failed: ${error?.message ?? 'no blob'}` }

    const buf = Buffer.from(await blob.arrayBuffer())
    const res = await normalizeUpload(buf, {
      contentType:      opts.contentType,
      filename:         opts.filename,
      pdfTargetBytes:   opts.pdfTargetBytes,
      imageTargetBytes: opts.imageTargetBytes,
    })
    if (!res.changed) return { changed: false, originalBytes: res.originalBytes, finalBytes: res.finalBytes, note: res.note }

    const up = await supabaseAdmin.storage.from(opts.bucket).upload(opts.path, res.buffer, {
      contentType: opts.contentType ?? undefined,
      upsert:      true,
    })
    if (up.error) return { changed: false, originalBytes: res.originalBytes, finalBytes: res.originalBytes, note: `re-upload failed: ${up.error.message}` }

    return { changed: true, originalBytes: res.originalBytes, finalBytes: res.finalBytes, note: res.note }
  } catch (e) {
    return { changed: false, originalBytes: 0, finalBytes: 0, note: `normalize-stored failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}
