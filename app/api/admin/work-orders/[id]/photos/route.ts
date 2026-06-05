// =====================================================================
// GET  /api/admin/work-orders/[id]/photos
// GET  /api/admin/work-orders/[id]/photos?refresh=1
//
// [id] = ticket id (the same id used by /admin/tickets/[id]).
//
// Lists photo attachments for a work order. On first call (no rows
// in the local mirror yet), or when ?refresh=1 is passed, MAIA pulls
// from CINC's /workOrderAttachments endpoint, decodes the base64
// bodies, uploads them to the `work-order-photos` bucket, and inserts
// rows in `work_order_attachments`. Subsequent calls read from the
// mirror only — no CINC round-trip.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  mirrorCincWorkOrderPhotos,
  listAttachmentsWithUrls,
  recordWorkOrderAttachment,
  deleteWorkOrderAttachment,
  isImageFilename,
  WO_FILE_SIZE_LIMIT_BYTES,
  STORAGE_BUCKET,
} from '@/lib/work-order-attachments'
import { normalizeStoredFile } from '@/lib/normalize-stored-file'

export const runtime = 'nodejs'

/** Look up a ticket for the attachments flow. Any ticket type is allowed —
 *  files attach by ticket_id (vendor portal, email, staff upload), not only
 *  to work orders. */
async function loadWorkOrder(ticketId: number) {
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .select('id, type, cinc_workorder_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (error)  return { error: `Ticket lookup failed: ${error.message}`, status: 500 as const }
  if (!data)  return { error: 'Ticket not found', status: 404 as const }
  return { ticket: data }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idParam } = await ctx.params
  const ticketId = Number(idParam)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from('tickets')
    .select('id, type, cinc_workorder_id')
    .eq('id', ticketId)
    .maybeSingle()

  if (ticketErr) {
    return NextResponse.json({ error: `Ticket lookup failed: ${ticketErr.message}` }, { status: 500 })
  }
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  // Attachments live in work_order_attachments keyed by ticket_id and serve
  // ANY ticket — vendor-portal uploads (W-9/COI/ACH/estimates), email +
  // staff files. A work order reclassified to a ticket must keep showing
  // them, so we no longer reject non-work_order tickets here. CINC photo
  // mirroring below is still gated on having a CINC work-order id.

  const url     = new URL(req.url)
  const refresh = url.searchParams.get('refresh') === '1'

  let syncResult: { mirrored: number; skipped: number; errors: string[] } | null = null
  const cincIdRaw = ticket.cinc_workorder_id as string | null
  const cincId    = cincIdRaw ? Number(cincIdRaw) : null

  if (cincId && Number.isFinite(cincId) && cincId > 0) {
    let shouldMirror = refresh
    if (!shouldMirror) {
      // First-view trigger: only mirror if we've never mirrored this WO before.
      const { count } = await supabaseAdmin
        .from('work_order_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('ticket_id', ticketId)
        .eq('source', 'cinc')
      shouldMirror = (count ?? 0) === 0
    }

    if (shouldMirror) {
      syncResult = await mirrorCincWorkOrderPhotos({ ticketId, cincWorkOrderId: cincId })
    }
  }

  const attachments = await listAttachmentsWithUrls(ticketId)

  return NextResponse.json({
    attachments,
    sync:        syncResult,                       // null if we didn't sync this call
    has_cinc_id: cincId !== null,
  })
}

// ---------------------------------------------------------------------
// POST — record a staff-uploaded photo. The bytes are already in the
// work-order-photos bucket (the browser PUT them directly via the
// signed URL from /photos/upload-url); this just inserts the row.
// ---------------------------------------------------------------------
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idParam } = await ctx.params
  const ticketId = Number(idParam)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  const wo = await loadWorkOrder(ticketId)
  if ('error' in wo) return NextResponse.json({ error: wo.error }, { status: wo.status })

  let body: { storage_path?: string; filename?: string; mime_type?: string; file_size_bytes?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const storagePath = (body.storage_path ?? '').trim()
  const filename    = (body.filename ?? '').trim()
  const fileSize    = Number(body.file_size_bytes)

  if (!filename || !isImageFilename(filename)) {
    return NextResponse.json({ error: 'A valid image filename is required' }, { status: 400 })
  }
  // The path must be the one our upload-url route minted for THIS work
  // order — reject anything pointing elsewhere in the bucket.
  if (!storagePath.startsWith(`wo-${ticketId}/`)) {
    return NextResponse.json({ error: 'storage_path does not belong to this work order' }, { status: 400 })
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: 'file_size_bytes is required' }, { status: 400 })
  }

  // Compress the browser-uploaded image in place (signed-URL upload = raw),
  // THEN enforce the size limit against the COMPRESSED size — so a big phone
  // photo that shrinks under the limit is accepted instead of rejected.
  const norm = await normalizeStoredFile({ bucket: STORAGE_BUCKET, path: storagePath, contentType: (body.mime_type ?? '').trim() || null, filename })
  if (norm.changed) console.log(`[wo-photos] normalized ${storagePath}: ${norm.note}`)
  const effectiveSize = norm.changed ? norm.finalBytes : fileSize
  if (effectiveSize > WO_FILE_SIZE_LIMIT_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${WO_FILE_SIZE_LIMIT_BYTES}-byte limit even after compression` }, { status: 400 })
  }

  const uploadedBy = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : null

  const rec = await recordWorkOrderAttachment({
    ticketId,
    source:          'staff_upload',
    storagePath,
    filename,
    mimeType:        (body.mime_type ?? '').trim() || undefined,
    fileSizeBytes:   effectiveSize,
    uploadedByEmail: uploadedBy,
  })
  if (!rec.ok) {
    return NextResponse.json({ error: rec.error }, { status: 500 })
  }

  const attachments = await listAttachmentsWithUrls(ticketId)
  return NextResponse.json({ ok: true, attachments })
}

// ---------------------------------------------------------------------
// DELETE /api/admin/work-orders/[id]/photos?attachmentId=<uuid>
// Removes a staff-uploaded or emailed photo. CINC-mirrored photos are
// protected (they re-mirror from CINC anyway).
// ---------------------------------------------------------------------
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idParam } = await ctx.params
  const ticketId = Number(idParam)
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
  }

  const attachmentId = new URL(req.url).searchParams.get('attachmentId') ?? ''
  if (!attachmentId) {
    return NextResponse.json({ error: 'attachmentId is required' }, { status: 400 })
  }

  const result = await deleteWorkOrderAttachment(ticketId, attachmentId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const attachments = await listAttachmentsWithUrls(ticketId)
  return NextResponse.json({ ok: true, attachments })
}
