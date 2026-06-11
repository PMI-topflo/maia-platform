// =====================================================================
// POST /api/admin/work-orders/[id]/photos/pull-from-email
//
// Back-fill: re-fetch the image attachments from the work order's source
// email thread and save them to Photos & files. Needed because MAIA only
// auto-attaches email photos when the ticket is ALREADY a work order at
// email time — a ticket classified as a work order later never got them.
// Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchGmailThread, fetchGmailAttachmentData, type GmailMessagePart } from '@/lib/gmail'
import { saveWorkOrderAttachmentBytes, isImageFilename, listAttachmentsWithUrls } from '@/lib/work-order-attachments'
import { isSignatureOrLogoImage } from '@/lib/email-attachment-filter'
import { enqueueOutbox } from '@/lib/tickets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Real photos are large; signature/logo graphics are tiny. Belt-and-suspenders
// alongside isSignatureOrLogoImage so a genuine complaint photo isn't dropped.
const MIN_PHOTO_BYTES = 12_000

interface FoundImage { messageId: string; filename: string; mimeType: string; attachmentId: string; size: number; inline: boolean }

function collectImages(messageId: string, parts: GmailMessagePart[] | undefined, out: FoundImage[]): void {
  for (const p of parts ?? []) {
    if (p.filename && p.body?.attachmentId && isImageFilename(p.filename)) {
      const inline = (p.headers ?? []).some(h => h.name.toLowerCase() === 'content-disposition' && /inline/i.test(h.value))
      out.push({ messageId, filename: p.filename, mimeType: p.mimeType, attachmentId: p.body.attachmentId, size: p.body.size ?? 0, inline })
    }
    if (p.parts) collectImages(messageId, p.parts, out)
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { id } = await ctx.params
  const ticketId = parseInt(id, 10)
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const { data: ticket } = await supabaseAdmin.from('tickets')
    .select('id, gmail_thread_id, cinc_workorder_id').eq('id', ticketId).maybeSingle()
  if (!ticket) return NextResponse.json({ error: 'ticket not found' }, { status: 404 })
  if (!ticket.gmail_thread_id) {
    return NextResponse.json({ ok: true, added: 0, note: 'This work order has no source email thread to pull from.' })
  }

  // Walk every message in the thread for image attachments.
  const messages = await fetchGmailThread(ticket.gmail_thread_id as string).catch(() => [])
  const found: FoundImage[] = []
  for (const m of messages) collectImages(m.id, m.payload?.parts, found)

  // Keep genuine photos: an image filename, not a signature/logo, above the size
  // floor. Dedupe by filename (a forwarded thread repeats the same attachment).
  const seen = new Set<string>()
  const keep = found.filter(a => {
    if (a.size < MIN_PHOTO_BYTES) return false
    if (isSignatureOrLogoImage({ filename: a.filename, mimeType: a.mimeType, size: a.size, inline: a.inline })) return false
    const key = a.filename.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Skip ones already on the work order (so re-runs don't duplicate).
  const existing = await listAttachmentsWithUrls(ticketId)
  const existingNames = new Set(existing.map(e => (e.filename ?? '').toLowerCase()))

  let added = 0
  const skipped: string[] = []
  for (const img of keep) {
    if (existingNames.has(img.filename.toLowerCase())) { skipped.push(img.filename); continue }
    try {
      const bytes  = await fetchGmailAttachmentData(img.messageId, img.attachmentId)
      const result = await saveWorkOrderAttachmentBytes({ ticketId, source: 'email', bytes, filename: img.filename, uploadedByEmail: actor ?? 'maia' })
      if (!result.ok) { skipped.push(img.filename); continue }
      added += 1
      if (ticket.cinc_workorder_id) {
        await enqueueOutbox(ticketId, 'work_order_attachment', 'push_photo', 'cinc', { attachmentId: result.id }).catch(() => null)
      }
    } catch { skipped.push(img.filename) }
  }

  const attachments = await listAttachmentsWithUrls(ticketId)
  return NextResponse.json({
    ok: true, added, skipped: skipped.length,
    note: added === 0
      ? (found.length === 0 ? 'No image attachments found in the email thread.' : 'No new photos — everything was already attached.')
      : `Pulled ${added} photo${added === 1 ? '' : 's'} from the email.`,
    attachments,
  })
}
