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
// HEIC/HEIF handling: iPhone photos arrive as HEIC, which browsers can't
// render. normalizeUpload transcodes those to JPEG; this helper then
// RENAMES the stored object to a .jpg path (deleting the old .heic) and
// returns the new path so the caller can re-point its DB row — every
// stored image ends up as a real .jpg.
//
// Best-effort: any failure leaves the original object untouched. Returns a
// note for logging so a silent no-op is visible.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeUpload } from '@/lib/pdf-normalize'

/** Swap a path/filename's extension to the given one (no dot). Replaces a
 *  trailing extension if present, otherwise appends. */
export function withExtension(p: string, ext: string): string {
  if (/\.[a-z0-9]{1,5}$/i.test(p)) return p.replace(/\.[a-z0-9]{1,5}$/i, `.${ext}`)
  return `${p}.${ext}`
}

export async function normalizeStoredFile(opts: {
  bucket:            string
  path:              string
  contentType?:      string | null
  filename?:         string | null
  pdfTargetBytes?:   number
  imageTargetBytes?: number
}): Promise<{ changed: boolean; originalBytes: number; finalBytes: number; note: string; contentType?: string; path: string; filename?: string }> {
  try {
    const { data: blob, error } = await supabaseAdmin.storage.from(opts.bucket).download(opts.path)
    if (error || !blob) return { changed: false, originalBytes: 0, finalBytes: 0, note: `download failed: ${error?.message ?? 'no blob'}`, path: opts.path }

    const buf = Buffer.from(await blob.arrayBuffer())
    const res = await normalizeUpload(buf, {
      contentType:      opts.contentType,
      filename:         opts.filename,
      pdfTargetBytes:   opts.pdfTargetBytes,
      imageTargetBytes: opts.imageTargetBytes,
    })
    if (!res.changed) return { changed: false, originalBytes: res.originalBytes, finalBytes: res.finalBytes, note: res.note, path: opts.path }

    // A format change (HEIC → JPEG) means the .heic path/filename are now
    // wrong — rename the object to .jpg so the extension matches the bytes.
    const newContentType = res.contentType ?? opts.contentType ?? undefined
    const newPath = res.ext ? withExtension(opts.path, res.ext) : opts.path
    const newFilename = res.ext && opts.filename ? withExtension(opts.filename, res.ext) : opts.filename ?? undefined

    const up = await supabaseAdmin.storage.from(opts.bucket).upload(newPath, res.buffer, {
      contentType: newContentType,
      upsert:      true,
    })
    if (up.error) return { changed: false, originalBytes: res.originalBytes, finalBytes: res.originalBytes, note: `re-upload failed: ${up.error.message}`, path: opts.path }

    // Drop the stale original only after the new object is safely written.
    if (newPath !== opts.path) {
      await supabaseAdmin.storage.from(opts.bucket).remove([opts.path]).catch(() => {})
    }

    return { changed: true, originalBytes: res.originalBytes, finalBytes: res.finalBytes, note: res.note, contentType: res.contentType, path: newPath, filename: newFilename }
  } catch (e) {
    return { changed: false, originalBytes: 0, finalBytes: 0, note: `normalize-stored failed: ${e instanceof Error ? e.message : String(e)}`, path: opts.path }
  }
}
