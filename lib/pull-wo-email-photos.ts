// =====================================================================
// lib/pull-wo-email-photos.ts
//
// Re-fetch the image attachments from a work order's source email thread and
// save them to Photos & files. MAIA only auto-attaches email photos when the
// ticket is ALREADY a work order at email time, so a ticket classified as a
// work order LATER never got them. Used by the manual "Pull from email" button
// AND fired automatically when a ticket is reclassified to a work order.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchGmailThread, fetchGmailAttachmentData, type GmailMessagePart } from '@/lib/gmail'
import { saveWorkOrderAttachmentBytes, isImageFilename, listAttachmentsWithUrls } from '@/lib/work-order-attachments'
import { isSignatureOrLogoImage } from '@/lib/email-attachment-filter'
import { enqueueOutbox } from '@/lib/tickets'

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

export interface PullPhotosResult { ok: boolean; added: number; skipped: number; note: string }

/** Pull image attachments from the ticket's source Gmail thread into the work
 *  order. Best-effort, idempotent (skips anything already attached). */
export async function pullWorkOrderPhotosFromEmail(ticketId: number, actorEmail?: string | null): Promise<PullPhotosResult> {
  const { data: ticket } = await supabaseAdmin.from('tickets')
    .select('id, gmail_thread_id, cinc_workorder_id, type').eq('id', ticketId).maybeSingle()
  if (!ticket) return { ok: false, added: 0, skipped: 0, note: 'ticket not found' }
  if (!ticket.gmail_thread_id) return { ok: true, added: 0, skipped: 0, note: 'This work order has no source email thread to pull from.' }

  const messages = await fetchGmailThread(ticket.gmail_thread_id as string).catch(() => [])
  const found: FoundImage[] = []
  for (const m of messages) collectImages(m.id, m.payload?.parts, found)

  const seen = new Set<string>()
  const keep = found.filter(a => {
    if (a.size < MIN_PHOTO_BYTES) return false
    if (isSignatureOrLogoImage({ filename: a.filename, mimeType: a.mimeType, size: a.size, inline: a.inline })) return false
    const key = a.filename.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const existing = await listAttachmentsWithUrls(ticketId)
  const existingNames = new Set(existing.map(e => (e.filename ?? '').toLowerCase()))

  let added = 0, skipped = 0
  for (const img of keep) {
    if (existingNames.has(img.filename.toLowerCase())) { skipped++; continue }
    try {
      const bytes  = await fetchGmailAttachmentData(img.messageId, img.attachmentId)
      const result = await saveWorkOrderAttachmentBytes({ ticketId, source: 'email', bytes, filename: img.filename, uploadedByEmail: actorEmail ?? 'maia' })
      if (!result.ok) { skipped++; continue }
      added++
      if (ticket.cinc_workorder_id) {
        await enqueueOutbox(ticketId, 'work_order_attachment', 'push_photo', 'cinc', { attachmentId: result.id }).catch(() => null)
      }
    } catch { skipped++ }
  }

  return {
    ok: true, added, skipped,
    note: added === 0
      ? (found.length === 0 ? 'No image attachments found in the email thread.' : 'No new photos — everything was already attached.')
      : `Pulled ${added} photo${added === 1 ? '' : 's'} from the email.`,
  }
}
