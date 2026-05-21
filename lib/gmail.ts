// Email sender — Resend primary, Gmail OAuth fallback
// All outbound email goes through sendEmail(); provider is chosen at runtime.

import { checkOutboundRateLimit, recordOutboundAttempt } from '@/lib/outbound-rate-limit'

const FROM = 'MAIA | PMI Top Florida Properties <maia@pmitop.com>'

// ── Normalise recipients ─────────────────────────────────────────────────────

function toAddresses(to: string | string[]): string[] {
  const raw = Array.isArray(to) ? to : [to]
  return raw.flatMap(t => t.split(',').map(s => s.trim())).filter(Boolean)
}

// ── Resend ───────────────────────────────────────────────────────────────────

async function sendViaResend({
  to,
  subject,
  html,
  text,
  replyTo,
  headers,
}: {
  to: string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
}): Promise<string | undefined> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('[Resend] RESEND_API_KEY not set')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to,
      subject,
      html,
      ...(text     && { text }),
      ...(replyTo  && { reply_to: replyTo }),
      ...(headers  && { headers }),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`[Resend] Send failed (${res.status}): ${err}`)
  }

  const json = await res.json() as { id?: string }
  return json.id
}

// ── Gmail OAuth fallback ─────────────────────────────────────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEND_URL  = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

let tokenCache: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.value

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type:    'refresh_token',
    }),
  })

  if (!res.ok) throw new Error(`[Gmail] Token refresh failed: ${await res.text()}`)

  const json = await res.json() as { access_token: string; expires_in: number }
  tokenCache = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return tokenCache.value
}

function buildRaw({ to, subject, html }: { to: string[]; subject: string; html: string }): string {
  const mime = [
    `From: ${FROM}`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf-8').toString('base64'),
  ].join('\r\n')

  return Buffer.from(mime, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sendViaGmail({ to, subject, html }: { to: string[]; subject: string; html: string }): Promise<void> {
  const hasGmail = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN
  if (!hasGmail) throw new Error('[Gmail] Credentials not configured')

  const accessToken = await getAccessToken()
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: buildRaw({ to, subject, html }) }),
  })

  if (!res.ok) throw new Error(`[Gmail] Send failed: ${await res.text()}`)
}

// ── Gmail API: inbox reading, watch registration, attachment download ─────────

export interface GmailMessagePart {
  partId:   string
  mimeType: string
  filename: string
  headers:  Array<{ name: string; value: string }>
  body:     { size: number; data?: string; attachmentId?: string }
  parts?:   GmailMessagePart[]
}

export interface GmailFullMessage {
  id:           string
  threadId:     string
  labelIds:     string[]
  snippet:      string
  internalDate: string
  payload: {
    headers:  Array<{ name: string; value: string }>
    mimeType: string
    body?:    { size: number; data?: string }
    parts?:   GmailMessagePart[]
  }
}

export async function fetchGmailMessage(messageId: string): Promise<GmailFullMessage> {
  const token = await getAccessToken()
  const res   = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`[Gmail] Fetch message failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<GmailFullMessage>
}

export interface GmailHistoryChanges {
  /** Ids of messages newly added to INBOX. */
  added:   string[]
  /** Ids of messages deleted, trashed, or archived out of INBOX. */
  removed: string[]
}

interface GmailHistoryMessageRef { id?: string; labelIds?: string[] }
interface GmailHistoryRecord {
  messagesAdded?:   Array<{ message?: GmailHistoryMessageRef }>
  messagesDeleted?: Array<{ message?: GmailHistoryMessageRef }>
  labelsRemoved?:   Array<{ message?: GmailHistoryMessageRef; labelIds?: string[] }>
}

// We ask Gmail for three history types: new INBOX arrivals (added) plus
// permanent deletes and label removals (removed). labelId=INBOX is NOT
// passed — it would filter out the very labelRemoved/messageDeleted
// records we need; INBOX scoping for additions is applied client-side.
const HISTORY_TYPES =
  'historyTypes=messageAdded&historyTypes=messageDeleted&historyTypes=labelRemoved'

/** Fold a Gmail history.list response into added / removed message ids.
 *  - added:   messageAdded events where the message landed in INBOX
 *  - removed: messageDeleted (permanent delete) + labelRemoved events
 *             that took INBOX off (trash or archive)
 *  A message added then removed inside the same window counts as removed. */
function collectHistoryChanges(history: GmailHistoryRecord[] | undefined): GmailHistoryChanges {
  const added   = new Set<string>()
  const removed = new Set<string>()
  for (const h of history ?? []) {
    for (const ma of h.messagesAdded ?? []) {
      const m = ma.message
      if (m?.id && (m.labelIds ?? []).includes('INBOX')) added.add(m.id)
    }
    for (const md of h.messagesDeleted ?? []) {
      if (md.message?.id) removed.add(md.message.id)
    }
    for (const lr of h.labelsRemoved ?? []) {
      if (lr.message?.id && (lr.labelIds ?? []).includes('INBOX')) removed.add(lr.message.id)
    }
  }
  for (const id of removed) added.delete(id)
  return { added: [...added], removed: [...removed] }
}

export async function fetchGmailHistory(startHistoryId: string): Promise<GmailHistoryChanges> {
  const token = await getAccessToken()
  const url   = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&${HISTORY_TYPES}`
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    if (res.status === 404) return { added: [], removed: [] }   // history purged — caller can re-sync
    throw new Error(`[Gmail] History API failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json() as { history?: GmailHistoryRecord[] }
  return collectHistoryChanges(data.history)
}

/** Recovery helper used when fetchGmailHistory returns empty (404 or
 *  out-of-range start id). Lists the most recent INBOX messages directly
 *  via the Gmail messages.list API. Idempotency in our processing pipeline
 *  (UNIQUE constraints on gmail_message_id and ticket_messages.external_id)
 *  prevents double-handling. */
export async function listRecentInboxMessages(limit: number = 20): Promise<string[]> {
  const token = await getAccessToken()
  const url   = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox&maxResults=${limit}`
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Error(`[Gmail] messages.list failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json() as { messages?: Array<{ id: string }> }
  return (data.messages ?? []).map(m => m.id)
}

export async function registerGmailWatch(
  topicName: string,
): Promise<{ historyId: string; expiration: string }> {
  const token = await getAccessToken()
  const res   = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ topicName, labelIds: ['INBOX'] }),
  })
  if (!res.ok) throw new Error(`[Gmail] Watch registration failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<{ historyId: string; expiration: string }>
}

export async function fetchGmailAttachmentData(
  messageId:    string,
  attachmentId: string,
): Promise<Buffer> {
  const token = await getAccessToken()
  const res   = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`[Gmail] Attachment fetch failed (${res.status}): ${await res.text()}`)
  const data = await res.json() as { data: string }
  return Buffer.from(data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** Per-account variant of fetchGmailAttachmentData — for messages in a
 *  connected staff Gmail inbox. The env-credential version above only
 *  sees the main maia@ mailbox. */
export async function fetchGmailAttachmentDataWithToken(
  messageId:    string,
  attachmentId: string,
  accessToken:  string,
): Promise<Buffer> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) throw new Error(`[Gmail] Attachment fetch failed (${res.status}): ${await res.text()}`)
  const data = await res.json() as { data: string }
  return Buffer.from(data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

// ── Per-account functions (staff Gmail OAuth) ────────────────────────────────

export async function refreshStaffToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`[Gmail staff] Token refresh failed: ${await res.text()}`)
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

export async function fetchGmailMessageWithToken(messageId: string, accessToken: string): Promise<GmailFullMessage> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) throw new Error(`[Gmail staff] Fetch message failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<GmailFullMessage>
}

export async function fetchGmailHistoryWithToken(startHistoryId: string, accessToken: string): Promise<GmailHistoryChanges> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&${HISTORY_TYPES}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) {
    if (res.status === 404) return { added: [], removed: [] }
    throw new Error(`[Gmail staff] History API failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json() as { history?: GmailHistoryRecord[] }
  return collectHistoryChanges(data.history)
}

/** Staff-account variant of listRecentInboxMessages — used as recovery
 *  when fetchGmailHistoryWithToken returns empty. */
export async function listRecentInboxMessagesWithToken(accessToken: string, limit: number = 20): Promise<string[]> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox&maxResults=${limit}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) {
    throw new Error(`[Gmail staff] messages.list failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json() as { messages?: Array<{ id: string }> }
  return (data.messages ?? []).map(m => m.id)
}

/** Every message id currently in INBOX (fully paginated). Used by the
 *  inbox reconcile to mirror MAIA's Emails view to the live inbox. */
export async function listAllInboxMessageIdsWithToken(accessToken: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken = ''
  do {
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=500'
      + (pageToken ? `&pageToken=${pageToken}` : '')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) throw new Error(`[Gmail] inbox list failed (${res.status}): ${await res.text()}`)
    const data = await res.json() as { messages?: Array<{ id: string }>; nextPageToken?: string }
    for (const m of (data.messages ?? [])) ids.push(m.id)
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return ids
}

/** Env-credentials variant — for the main MAIA inbox. */
export async function listAllInboxMessageIds(): Promise<string[]> {
  return listAllInboxMessageIdsWithToken(await getAccessToken())
}

/** The INBOX message ids plus a best-effort map of id → Gmail
 *  internalDate (epoch ms as a string). The id list is authoritative;
 *  the dates map may omit a message whose metadata fetch failed (the
 *  caller treats a missing date as "leave it unchanged"). Used by the
 *  inbox reconcile to stamp each row with its message's TRUE date so
 *  the Communications view sorts like Gmail. */
export async function listInboxMessageIdsAndDatesWithToken(
  accessToken: string,
): Promise<{ ids: string[]; dates: Map<string, string> }> {
  const ids   = await listAllInboxMessageIdsWithToken(accessToken)
  const dates = new Map<string, string>()
  const BATCH = 12
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    await Promise.all(chunk.map(async id => {
      try {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=minimal`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        if (!res.ok) return
        const m = await res.json() as { id?: string; internalDate?: string }
        if (m.id && m.internalDate) dates.set(m.id, m.internalDate)
      } catch {
        /* best-effort — a missing date just leaves the row unchanged */
      }
    }))
  }
  return { ids, dates }
}

/** Env-credentials variant — for the main MAIA inbox. */
export async function listInboxMessageIdsAndDates(): Promise<{ ids: string[]; dates: Map<string, string> }> {
  return listInboxMessageIdsAndDatesWithToken(await getAccessToken())
}

export interface GmailProfile {
  emailAddress:  string
  messagesTotal: number
  threadsTotal:  number
  historyId:     string
}

/** Gmail users.getProfile — the mailbox's own view of itself: total
 *  message count and the current (live) historyId. Used by the account
 *  diagnostics to compare what Gmail sees against what MAIA stored. */
export async function fetchGmailProfileWithToken(accessToken: string): Promise<GmailProfile> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`[Gmail staff] Profile fetch failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<GmailProfile>
}

/** users.getProfile for the main MAIA account (env-var credentials) —
 *  used to diagnose the maia@ inbox the same way connected staff inboxes
 *  are diagnosed. */
export async function fetchGmailProfile(): Promise<GmailProfile> {
  return fetchGmailProfileWithToken(await getAccessToken())
}

export async function registerGmailWatchWithToken(topicName: string, accessToken: string): Promise<{ historyId: string; expiration: string }> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ topicName, labelIds: ['INBOX'] }),
  })
  if (!res.ok) throw new Error(`[Gmail staff] Watch registration failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<{ historyId: string; expiration: string }>
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface SendEmailResult {
  messageId?: string
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  headers,
}: {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
}): Promise<SendEmailResult> {
  const addresses = toAddresses(to)
  if (addresses.length === 0) throw new Error('[Email] No recipients provided')

  // Application-level rate limit at the sendEmail boundary. Catches loops
  // through ANY caller (structured-record replies, ticket notifications,
  // vendor inquiries, courtesy emails, etc.) — not just freeform. See
  // lib/outbound-rate-limit.ts for caps and env-var overrides.
  const decision = await checkOutboundRateLimit({ toEmails: addresses, subject })
  if (!decision.allow) {
    console.error(`[sendEmail] BLOCKED by ${decision.reason}. ${decision.detail}`)
    await recordOutboundAttempt({ toEmails: addresses, subject, blockedReason: decision.reason })
    return { messageId: `blocked-by-${decision.reason}` }
  }

  const body = html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${text ?? ''}</pre>`

  let messageId: string | undefined
  if (process.env.RESEND_API_KEY) {
    messageId = await sendViaResend({ to: addresses, subject, html: body, text, replyTo, headers })
  } else {
    await sendViaGmail({ to: addresses, subject, html: body })
  }

  // Record AFTER successful provider call so the counter reflects what
  // actually went out (not what we attempted but failed to send).
  await recordOutboundAttempt({ toEmails: addresses, subject })

  return messageId !== undefined ? { messageId } : {}
}
