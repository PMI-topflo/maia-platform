// =====================================================================
// lib/vendor-link.ts
// Mint a vendor upload link for a work order and email it to the vendor.
// Shared by the admin work-order button and the Gmail add-on button.
// Staff-triggered (Paola) — not an automatic Maia action.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { signVendorUploadToken } from '@/lib/vendor-upload-token'
import { sendEmail } from '@/lib/gmail'
import { appendMessage } from '@/lib/tickets'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function sendVendorUploadLink(opts: {
  ticketId:        number
  recipientEmail?: string | null   // overrides the WO's vendor email
  sentBy:          string
}): Promise<{ ok: true; link: string; recipient: string } | { ok: false; error: string }> {
  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_number, subject, association_code')
    .eq('id', opts.ticketId)
    .single()
  if (!ticket) return { ok: false, error: 'work order not found' }

  const { data: wod } = await supabaseAdmin
    .from('work_order_details').select('vendor_name, vendor_email').eq('ticket_id', opts.ticketId).maybeSingle()

  const recipient = (opts.recipientEmail || wod?.vendor_email || '').trim()
  if (!recipient || !recipient.includes('@')) {
    return { ok: false, error: 'no vendor email — add one on the work order or type it in' }
  }

  const token = await signVendorUploadToken(opts.ticketId)
  const link  = `${APP_URL}/vendor/upload/${token}`

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
<p>Hello${wod?.vendor_name ? ' ' + wod.vendor_name : ''},</p>
<p>Please use the secure link below to upload your <strong>estimate, invoice, or job photos</strong> for work order <strong>${ticket.ticket_number}</strong>${ticket.subject ? ` — ${ticket.subject}` : ''}.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Upload your files</a></p>
<p style="color:#6b7280;font-size:12px">Or paste this link into your browser:<br>${link}</p>
<p style="color:#6b7280;font-size:12px">This link is specific to this work order and expires in 30 days.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="color:#9ca3af;font-size:11px;margin:0">PMI Top Florida Properties</p>
</body></html>`

  await sendEmail({ to: recipient, subject: `Upload your files for ${ticket.ticket_number}`, html })

  await appendMessage(opts.ticketId, {
    direction: 'outbound', channel: 'email', from_addr: opts.sentBy, to_addr: recipient,
    subject: `Upload link for ${ticket.ticket_number}`,
    body: `Sent ${recipient} a secure upload link for estimates/invoices/photos.`,
  }).catch(() => null)

  return { ok: true, link, recipient }
}
