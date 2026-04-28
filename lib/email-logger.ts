import { supabaseAdmin } from '@/lib/supabase-admin'

export interface EmailLogEntry {
  direction?: 'outbound' | 'inbound'
  fromEmail?: string
  toEmail: string
  subject: string
  bodyPreview?: string
  fullBody?: string
  persona?: string
  associationCode?: string
  status?: string
  resendMessageId?: string
  sentBy?: string
  sentByStaffId?: string
  conversationId?: string
}

export async function logEmail(entry: EmailLogEntry): Promise<void> {
  const preview = entry.bodyPreview
    ?? (entry.fullBody ? entry.fullBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : undefined)

  const { error } = await supabaseAdmin.from('email_logs').insert({
    direction:          entry.direction ?? 'outbound',
    from_email:         entry.fromEmail ?? 'maia@pmitop.com',
    to_email:           entry.toEmail,
    subject:            entry.subject,
    body_preview:       preview,
    full_body:          entry.fullBody,
    persona:            entry.persona,
    association_code:   entry.associationCode,
    status:             entry.status ?? 'sent',
    resend_message_id:  entry.resendMessageId,
    sent_by:            entry.sentBy ?? 'maia',
    sent_by_staff_id:   entry.sentByStaffId ?? null,
    conversation_id:    entry.conversationId ?? null,
  })

  if (error) {
    console.error('[email-logger] Failed to log email:', error.message)
  }
}
