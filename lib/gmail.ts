// Email sender — Resend primary, Gmail OAuth fallback
// All outbound email goes through sendEmail(); provider is chosen at runtime.

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

export async function fetchGmailHistory(startHistoryId: string): Promise<string[]> {
  const token = await getAccessToken()
  const url   = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded&labelId=INBOX`
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    if (res.status === 404) return []   // history purged — caller can re-sync
    throw new Error(`[Gmail] History API failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json() as {
    history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>
  }
  const ids: string[] = []
  for (const h of (data.history ?? [])) {
    for (const ma of (h.messagesAdded ?? [])) {
      if (ma.message?.id && !ids.includes(ma.message.id)) ids.push(ma.message.id)
    }
  }
  return ids
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

  const body = html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${text ?? ''}</pre>`

  if (process.env.RESEND_API_KEY) {
    const messageId = await sendViaResend({ to: addresses, subject, html: body, text, replyTo, headers })
    return { messageId }
  }

  await sendViaGmail({ to: addresses, subject, html: body })
  return {}
}
