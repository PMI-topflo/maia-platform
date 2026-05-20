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
  /** Gmail messageId of the source inbound email. Recorded so the
   *  Gmail-watch webhook can dismiss this row when the message is later
   *  deleted / trashed / archived in Gmail. */
  gmailMessageId?: string
  /** Gmail internalDate (epoch milliseconds as a string) of an inbound
   *  email. When the message is genuinely old, it's a backlog replay,
   *  not live mail — the row is logged pre-dismissed so it never floods
   *  the Communications queue. */
  emailDate?: string
}

// An inbound email whose own date is older than this is treated as a
// backlog replay (a stale Gmail cursor re-feeding mail MAIA already saw,
// or never should). It is still logged for audit, but pre-dismissed so
// it stays off the working queue. Generous enough to let a genuine
// short watch outage (a day or two of real unhandled mail) through.
const STALE_INBOUND_REPLAY_DAYS = 5

export async function logEmail(entry: EmailLogEntry): Promise<void> {
  const preview = entry.bodyPreview
    ?? (entry.fullBody ? entry.fullBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : undefined)

  const direction = entry.direction ?? 'outbound'
  const fromEmail = entry.fromEmail ?? 'maia@pmitop.com'
  const toEmail   = entry.toEmail

  // Idempotency guard. The same inbound message can reach logEmail more
  // than once — Pub/Sub redelivery, a stale-cursor backlog replay, the
  // recovery rescan. email_logs has no unique constraint on
  // gmail_message_id, so each re-log would insert a duplicate row, and
  // the Communications view would group N identical copies into one
  // bogus "N-message thread". Skip if this message is already logged.
  if (direction === 'inbound' && entry.gmailMessageId) {
    const { data: existing, error: dupErr } = await supabaseAdmin
      .from('email_logs')
      .select('id')
      .eq('gmail_message_id', entry.gmailMessageId)
      .limit(1)
      .maybeSingle()
    if (!dupErr && existing) return   // already logged — drop the duplicate
  }

  // Pre-compute auto-dismiss reason for inbound mail so we can stamp
  // the row at insert time instead of doing a second UPDATE.
  const autoDismiss = direction === 'inbound'
    ? await detectAutoDismissReason(fromEmail, toEmail)
    : null

  const insertRow: Record<string, unknown> = {
    direction,
    from_email:         fromEmail,
    to_email:           toEmail,
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
  }
  if (entry.gmailMessageId) {
    insertRow.gmail_message_id = entry.gmailMessageId
  }

  // A genuinely-old inbound email arriving now is a backlog replay, not
  // live mail — keep it off the working queue.
  const staleEpoch = direction === 'inbound' && entry.emailDate
    ? Number(entry.emailDate)
    : NaN
  const isStaleReplay = Number.isFinite(staleEpoch)
    && Date.now() - staleEpoch > STALE_INBOUND_REPLAY_DAYS * 86_400_000

  // Inbound mail to maia@ is MAIA's own command channel — @maia traffic
  // and bot replies, not customer correspondence staff triage. It still
  // gets logged + processed into tickets, but stays off the Emails tab.
  const isMaiaInbox = direction === 'inbound'
    && normalizeAddress(toEmail) === 'maia@pmitop.com'

  if (autoDismiss) {
    insertRow.dismissed_at        = new Date().toISOString()
    insertRow.dismissed_by_email  = 'system'
    insertRow.auto_dismiss_reason = autoDismiss
  } else if (isStaleReplay || isMaiaInbox) {
    insertRow.dismissed_at        = new Date().toISOString()
    insertRow.dismissed_by_email  = 'system'
  }

  const inserted = await insertEmailLog(insertRow)
  if (!inserted) return

  if (entry.gmailThreadId) {
    void autolinkEmailToThreadTickets(inserted.id, entry.gmailThreadId)
  }
}

/** Insert an email_logs row, tolerating a not-yet-migrated
 *  gmail_message_id column: if the insert fails because that column is
 *  missing, retry once without it so logging still succeeds. */
async function insertEmailLog(row: Record<string, unknown>): Promise<{ id: string } | null> {
  const first = await supabaseAdmin.from('email_logs').insert(row).select('id').single()
  if (!first.error && first.data) return { id: String(first.data.id) }

  if (first.error && 'gmail_message_id' in row && /gmail_message_id/i.test(first.error.message)) {
    const rest = { ...row }
    delete rest.gmail_message_id
    const retry = await supabaseAdmin.from('email_logs').insert(rest).select('id').single()
    if (!retry.error && retry.data) return { id: String(retry.data.id) }
    console.error('[email-logger] Failed to log email (retry without gmail_message_id):', retry.error?.message)
    return null
  }

  console.error('[email-logger] Failed to log email:', first.error?.message)
  return null
}

// ─────────────────────────────────────────────────────────────────────
// Auto-dismiss detection — runs once per inbound logEmail call.
// Two caches reduce DB pressure: noise patterns + staff emails. Both
// expire after a short TTL so the lists stay fresh without restart.
// ─────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes
let noisePatternsCache:    { fetched: number; values: string[] } | null = null
let staffEmailsCache:      { fetched: number; values: Set<string> } | null = null
let staffInboxesCache:     { fetched: number; values: Set<string> } | null = null

async function getNoisePatterns(): Promise<string[]> {
  if (noisePatternsCache && Date.now() - noisePatternsCache.fetched < CACHE_TTL_MS) {
    return noisePatternsCache.values
  }
  const { data, error } = await supabaseAdmin
    .from('email_noise_senders')
    .select('pattern')
  if (error) return noisePatternsCache?.values ?? []   // degrade silently pre-migration
  const values = (data ?? []).map(r => (r.pattern as string).toLowerCase())
  noisePatternsCache = { fetched: Date.now(), values }
  return values
}

async function getStaffEmails(): Promise<Set<string>> {
  if (staffEmailsCache && Date.now() - staffEmailsCache.fetched < CACHE_TTL_MS) {
    return staffEmailsCache.values
  }
  const { data, error } = await supabaseAdmin
    .from('pmi_staff')
    .select('email, personal_email, alt_emails')
  if (error) return staffEmailsCache?.values ?? new Set()
  const values = new Set<string>()
  for (const r of (data ?? []) as Array<{ email: string | null; personal_email: string | null; alt_emails: string[] | null }>) {
    if (r.email)          values.add(r.email.toLowerCase())
    if (r.personal_email) values.add(r.personal_email.toLowerCase())
    for (const a of r.alt_emails ?? []) if (a) values.add(a.toLowerCase())
  }
  staffEmailsCache = { fetched: Date.now(), values }
  return values
}

async function getStaffInboxes(): Promise<Set<string>> {
  if (staffInboxesCache && Date.now() - staffInboxesCache.fetched < CACHE_TTL_MS) {
    return staffInboxesCache.values
  }
  const { data, error } = await supabaseAdmin
    .from('staff_gmail_accounts')
    .select('gmail_address')
  if (error) return staffInboxesCache?.values ?? new Set()
  const values = new Set<string>()
  for (const r of (data ?? []) as Array<{ gmail_address: string | null }>) {
    if (r.gmail_address) values.add(r.gmail_address.toLowerCase())
  }
  staffInboxesCache = { fetched: Date.now(), values }
  return values
}

// Gmail sometimes stores from/to as the bare address ("foo@bar.com")
// and sometimes wraps it in angle brackets ("<foo@bar.com>"). Strip the
// brackets so denylist + staff-set lookups work regardless of form.
function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/^<|>$/g, '').trim()
}

async function detectAutoDismissReason(
  fromEmail: string,
  toEmail:   string,
): Promise<'noise_sender' | 'internal' | null> {
  const lcFrom = normalizeAddress(fromEmail)
  const lcTo   = normalizeAddress(toEmail)

  // 1. Noise sender — exact email OR @domain pattern match.
  const patterns = await getNoisePatterns()
  for (const p of patterns) {
    if (p.startsWith('@')) {
      if (lcFrom.endsWith(p)) return 'noise_sender'
    } else if (lcFrom === p) {
      return 'noise_sender'
    }
  }

  // 2. Internal staff-to-staff — both ends are known staff addresses
  //    (any combination of pmi_staff, alt_emails, or a connected
  //    Gmail inbox counts).
  const [staffEmails, staffInboxes] = await Promise.all([
    getStaffEmails(),
    getStaffInboxes(),
  ])
  const fromIsStaff = staffEmails.has(lcFrom) || staffInboxes.has(lcFrom)
  const toIsStaff   = staffEmails.has(lcTo)   || staffInboxes.has(lcTo)
  if (fromIsStaff && toIsStaff) {
    return 'internal'
  }

  return null
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
