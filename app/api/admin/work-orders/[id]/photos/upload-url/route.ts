// =====================================================================
// POST /api/admin/work-orders/[id]/photos/upload-url
//
// Returns a one-time signed upload URL so the browser can PUT a photo
// DIRECTLY to Supabase Storage, bypassing Vercel's 4.5 MB function body
// limit (phone photos routinely exceed it). After the upload completes
// the client POSTs metadata to /api/admin/work-orders/[id]/photos to
// insert the work_order_attachments row.
//
// Staff-only. The server picks the storage path so the client can't
// write outside this work order's folder.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  STORAGE_BUCKET,
  ensureWorkOrderBucket,
  isImageFilename,
  workOrderStoragePath,
} from '@/lib/work-order-attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  let body: { filename?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const filename = (body.filename ?? '').trim()
  if (!filename) {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 })
  }
  if (!isImageFilename(filename)) {
    return NextResponse.json({ error: 'Only image files (png, jpg, gif, webp, heic) are accepted' }, { status: 400 })
  }

  // The target must exist and be a work order.
  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from('tickets')
    .select('id, type')
    .eq('id', ticketId)
    .maybeSingle()
  if (ticketErr) {
    return NextResponse.json({ error: `Ticket lookup failed: ${ticketErr.message}` }, { status: 500 })
  }
  if (!ticket)                       return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  // Any ticket type may have files attached (vendor docs, etc.), not just
  // work orders — so we don't reject non-work_order tickets here.

  const bucket = await ensureWorkOrderBucket()
  if (!bucket.ok) {
    return NextResponse.json(
      { error: `Storage bucket "${STORAGE_BUCKET}" is not ready: ${bucket.reason}` },
      { status: 500 },
    )
  }

  const storagePath = workOrderStoragePath(ticketId, filename)
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath)

  if (error || !data?.signedUrl || !data?.token) {
    return NextResponse.json(
      { error: `Could not generate upload URL: ${error?.message ?? 'no token returned'}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    storage_path: storagePath,
    token:        data.token,
    signed_url:   data.signedUrl,
  })
}
