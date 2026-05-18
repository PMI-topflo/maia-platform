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
  /** Gmail threadId. When provided, the new email_log row joins any
   *  existing communication_ticket_links for the same thread (so a
   *  ticket linked once auto-extends to every future reply). */
  gmailThreadId?: string
}

export async function logEmail(entry: EmailLogEntry): Promise<void> {
  const preview = entry.bodyPreview
    ?? (entry.fullBody ? entry.fullBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : undefined)

  const { data: inserted, error } = await supabaseAdmin
    .from('email_logs')
    .insert({
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
      gmail_thread_id:    entry.gmailThreadId ?? null,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[email-logger] Failed to log email:', error?.message)
    return
  }

  if (entry.gmailThreadId) {
    void autolinkEmailToThreadTickets(String(inserted.id), entry.gmailThreadId)
  }
}

/** After a new inbound or outbound email is logged, attach it to every
 *  ticket already linked to its Gmail thread. The unique constraint on
 *  (communication_type, communication_id, ticket_id) makes this safe
 *  to call repeatedly — a re-fire just no-ops on duplicates. */
async function autolinkEmailToThreadTickets(emailLogId: string, threadId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('communication_ticket_links')
    .select('ticket_id')
    .eq('communication_type', 'email')
    .eq('gmail_thread_id', threadId)

  if (error) {
    // Column missing pre-migration → silently degrade. Same pattern as
    // other staff-lookup helpers in this codebase.
    if (/gmail_thread_id|communication_ticket_links/.test(error.message)) return
    console.error('[email-logger] autolink lookup failed:', error.message)
    return
  }
  if (!data || data.length === 0) return

  const ticketIds = Array.from(new Set(data.map(r => r.ticket_id as number)))
  if (ticketIds.length === 0) return

  const rows = ticketIds.map(ticket_id => ({
    communication_type: 'email' as const,
    communication_id:   emailLogId,
    ticket_id,
    gmail_thread_id:    threadId,
    linked_by_email:    'system',
  }))

  const { error: insertErr } = await supabaseAdmin
    .from('communication_ticket_links')
    .upsert(rows, { onConflict: 'communication_type,communication_id,ticket_id', ignoreDuplicates: true })

  if (insertErr && !/duplicate key/.test(insertErr.message)) {
    console.error('[email-logger] autolink insert failed:', insertErr.message)
  }
}
