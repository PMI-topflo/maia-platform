// =====================================================================
// lib/work-order-attachments.ts
//
// Storage + DB helpers for the `work_order_attachments` table.
//
// Today this only covers source='cinc' — the on-first-view mirror of
// vendor photos attached inside CINC. Source 'email' (task 2) and
// 'staff_upload' (task 3) will reuse the same bucket + table.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { listWorkOrderAttachments, type CincAttachment } from '@/lib/integrations/cinc'

export const STORAGE_BUCKET = 'work-order-photos'
const SIGNED_URL_TTL_SECONDS = 60 * 60          // 1 hour
const FILE_SIZE_LIMIT_BYTES  = 25 * 1024 * 1024 // 25 MB per file

const IMAGE_EXTENSIONS: Record<string, string> = {
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

function extOf(filename: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename)
  return m ? m[1].toLowerCase() : ''
}

function isImage(filename: string): boolean {
  return extOf(filename) in IMAGE_EXTENSIONS
}

function mimeFor(filename: string): string {
  return IMAGE_EXTENSIONS[extOf(filename)] ?? 'application/octet-stream'
}

// ─────────────────────────────────────────────────────────────────────
// Bucket
// ─────────────────────────────────────────────────────────────────────
let _bucketEnsured = false
async function ensureBucket(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (_bucketEnsured) return { ok: true }

  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets()
  if (listErr) return { ok: false, reason: `listBuckets failed: ${listErr.message}` }
  if (buckets?.some(b => b.name === STORAGE_BUCKET)) {
    _bucketEnsured = true
    return { ok: true }
  }

  const { error: createErr } = await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
    public:        false,
    fileSizeLimit: FILE_SIZE_LIMIT_BYTES,
  })
  if (createErr) return { ok: false, reason: `createBucket failed: ${createErr.message}` }
  _bucketEnsured = true
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────
export interface WorkOrderAttachmentRow {
  id:                  string
  ticket_id:           number
  cinc_workorder_id:   number | null
  source:              'cinc' | 'email' | 'staff_upload'
  storage_path:        string
  filename:            string
  mime_type:           string
  file_size_bytes:     number
  cinc_filename:       string | null
  cinc_created_date:   string | null
  uploaded_by_email:   string | null
  mirrored_at:         string
  created_at:          string
}

export interface WorkOrderAttachmentWithUrl extends WorkOrderAttachmentRow {
  signed_url: string
}

// ─────────────────────────────────────────────────────────────────────
// Mirror CINC attachments for one work order
// ─────────────────────────────────────────────────────────────────────
export async function mirrorCincWorkOrderPhotos(opts: {
  ticketId:          number
  cincWorkOrderId:   number
}): Promise<{ mirrored: number; skipped: number; errors: string[] }> {
  const { ticketId, cincWorkOrderId } = opts
  const errors: string[] = []

  const bucket = await ensureBucket()
  if (!bucket.ok) {
    return { mirrored: 0, skipped: 0, errors: [bucket.reason] }
  }

  // Load CINC's current view of the WO's attachments.
  let cincAttachments: CincAttachment[]
  try {
    cincAttachments = await listWorkOrderAttachments(cincWorkOrderId)
  } catch (err) {
    return { mirrored: 0, skipped: 0, errors: [`CINC fetch failed: ${(err as Error).message}`] }
  }

  // Load what we already have for this ticket so we can skip duplicates
  // without leaning on the DB's unique-index conflict (cheaper + lets
  // us emit a clean skip count).
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('work_order_attachments')
    .select('cinc_filename, cinc_created_date')
    .eq('ticket_id', ticketId)
    .eq('source', 'cinc')

  if (existingErr) {
    return { mirrored: 0, skipped: 0, errors: [`existing fetch failed: ${existingErr.message}`] }
  }

  const existingKeys = new Set(
    (existing ?? []).map(r => `${r.cinc_filename}|${r.cinc_created_date}`),
  )

  let mirrored = 0
  let skipped  = 0

  for (const att of cincAttachments) {
    if (!isImage(att.FileName)) { skipped++; continue }

    // Normalize the CINC timestamp into a real ISO-8601 with timezone
    // so it matches what Postgres stored last time (else dedupe misses).
    const cincCreatedIso = new Date(att.CreatedDate).toISOString()
    const dedupeKey      = `${att.FileName}|${cincCreatedIso}`
    if (existingKeys.has(dedupeKey)) { skipped++; continue }

    // Decode base64 → Buffer → upload
    let buf: Buffer
    try {
      buf = Buffer.from(att.FileContent, 'base64')
    } catch (err) {
      errors.push(`decode failed for ${att.FileName}: ${(err as Error).message}`)
      continue
    }

    if (buf.byteLength > FILE_SIZE_LIMIT_BYTES) {
      errors.push(`${att.FileName} exceeds ${FILE_SIZE_LIMIT_BYTES} byte limit (${buf.byteLength})`)
      continue
    }

    const id          = globalThis.crypto.randomUUID()
    const ext         = extOf(att.FileName) || 'bin'
    const storagePath = `wo-${ticketId}/${id}.${ext}`
    const mime        = mimeFor(att.FileName)

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buf, { contentType: mime, upsert: false })

    if (uploadErr) {
      errors.push(`upload failed for ${att.FileName}: ${uploadErr.message}`)
      continue
    }

    const { error: insertErr } = await supabaseAdmin
      .from('work_order_attachments')
      .insert({
        id,
        ticket_id:          ticketId,
        cinc_workorder_id:  cincWorkOrderId,
        source:             'cinc',
        storage_path:       storagePath,
        filename:           att.FileName,
        mime_type:          mime,
        file_size_bytes:    buf.byteLength,
        cinc_filename:      att.FileName,
        cinc_created_date:  cincCreatedIso,
      })

    if (insertErr) {
      // Roll the upload back so we don't leak an orphan object on a
      // failed insert (e.g. unique-index race with a concurrent mirror).
      await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath])
      errors.push(`insert failed for ${att.FileName}: ${insertErr.message}`)
      continue
    }

    mirrored++
  }

  return { mirrored, skipped, errors }
}

// ─────────────────────────────────────────────────────────────────────
// Email + staff-upload attachments (sources 'email' and 'staff_upload')
// ─────────────────────────────────────────────────────────────────────

/** Public wrapper around the private bucket bootstrap. */
export async function ensureWorkOrderBucket(): Promise<{ ok: true } | { ok: false; reason: string }> {
  return ensureBucket()
}

/** Whether a filename looks like an image we accept. */
export function isImageFilename(filename: string): boolean {
  return isImage(filename)
}

export const WO_FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_BYTES

/** Storage object key for a new attachment: wo-<ticketId>/<uuid>.<ext>. */
export function workOrderStoragePath(ticketId: number, filename: string): string {
  const ext = extOf(filename) || 'bin'
  return `wo-${ticketId}/${globalThis.crypto.randomUUID()}.${ext}`
}

/** Insert a work_order_attachments row for an object already uploaded to
 *  the work-order-photos bucket (source 'email' or 'staff_upload'). */
export async function recordWorkOrderAttachment(opts: {
  ticketId:         number
  source:           'email' | 'staff_upload'
  storagePath:      string
  filename:         string
  mimeType?:        string
  fileSizeBytes:    number
  uploadedByEmail?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const id = globalThis.crypto.randomUUID()
  const { error } = await supabaseAdmin.from('work_order_attachments').insert({
    id,
    ticket_id:         opts.ticketId,
    source:            opts.source,
    storage_path:      opts.storagePath,
    filename:          opts.filename,
    mime_type:         opts.mimeType || mimeFor(opts.filename),
    file_size_bytes:   opts.fileSizeBytes,
    uploaded_by_email: opts.uploadedByEmail ?? null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, id }
}

/** Upload image bytes to the bucket and record the row in one step —
 *  used by the email ingestion path, which has the bytes server-side.
 *  CINC-sourced photos are NOT routed here (see mirrorCincWorkOrderPhotos). */
export async function saveWorkOrderAttachmentBytes(opts: {
  ticketId:         number
  source:           'email' | 'staff_upload'
  bytes:            Buffer
  filename:         string
  uploadedByEmail?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isImage(opts.filename)) {
    return { ok: false, error: `not an image: ${opts.filename}` }
  }
  if (opts.bytes.byteLength > FILE_SIZE_LIMIT_BYTES) {
    return { ok: false, error: `${opts.filename} exceeds the ${FILE_SIZE_LIMIT_BYTES}-byte limit` }
  }
  const bucket = await ensureBucket()
  if (!bucket.ok) return { ok: false, error: bucket.reason }

  const storagePath = workOrderStoragePath(opts.ticketId, opts.filename)
  const mime        = mimeFor(opts.filename)
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, opts.bytes, { contentType: mime, upsert: false })
  if (uploadErr) return { ok: false, error: `upload failed: ${uploadErr.message}` }

  const rec = await recordWorkOrderAttachment({
    ticketId:        opts.ticketId,
    source:          opts.source,
    storagePath,
    filename:        opts.filename,
    mimeType:        mime,
    fileSizeBytes:   opts.bytes.byteLength,
    uploadedByEmail: opts.uploadedByEmail ?? null,
  })
  if (!rec.ok) {
    // Roll back the orphaned object so a failed insert leaves no leak.
    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath])
    return { ok: false, error: rec.error }
  }
  return rec
}

/** Delete one non-CINC attachment (its row + its storage object). CINC
 *  rows are left alone — they re-mirror from CINC and aren't ours to drop. */
export async function deleteWorkOrderAttachment(
  ticketId: number,
  attachmentId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: row, error: lookupErr } = await supabaseAdmin
    .from('work_order_attachments')
    .select('id, ticket_id, source, storage_path')
    .eq('id', attachmentId)
    .maybeSingle()
  if (lookupErr)  return { ok: false, error: lookupErr.message, status: 500 }
  if (!row)       return { ok: false, error: 'Attachment not found', status: 404 }
  if (row.ticket_id !== ticketId) {
    return { ok: false, error: 'Attachment does not belong to this work order', status: 400 }
  }
  if (row.source === 'cinc') {
    return { ok: false, error: 'CINC-sourced photos cannot be deleted here', status: 400 }
  }

  await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([row.storage_path as string])
  const { error: delErr } = await supabaseAdmin
    .from('work_order_attachments')
    .delete()
    .eq('id', attachmentId)
  if (delErr) return { ok: false, error: delErr.message, status: 500 }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────
// List all attachments for a ticket (regardless of source) with
// signed URLs ready for <img src>.
// ─────────────────────────────────────────────────────────────────────
export async function listAttachmentsWithUrls(
  ticketId: number,
): Promise<WorkOrderAttachmentWithUrl[]> {
  const { data, error } = await supabaseAdmin
    .from('work_order_attachments')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })

  if (error || !data) return []

  const rows = data as WorkOrderAttachmentRow[]
  if (rows.length === 0) return []

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrls(rows.map(r => r.storage_path), SIGNED_URL_TTL_SECONDS)

  if (signErr || !signed) return []

  return rows.map((row, i) => ({
    ...row,
    signed_url: signed[i]?.signedUrl ?? '',
  })).filter(r => r.signed_url)
}
