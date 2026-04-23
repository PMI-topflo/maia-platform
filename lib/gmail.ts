// Gmail API via OAuth2 — no external packages, pure fetch

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEND_URL  = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const FROM      = 'MAIA <maia@mypmitop.com>'

// Module-level cache — survives across requests within the same serverless instance
let tokenCache: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.value
  }

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

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[Gmail] Token refresh failed: ${text}`)
  }

  const json = await res.json() as { access_token: string; expires_in: number }
  tokenCache = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return tokenCache.value
}

// Normalize to a flat array, handling comma-separated strings from the webhook
function toAddresses(to: string | string[]): string[] {
  const raw = Array.isArray(to) ? to : [to]
  return raw.flatMap(t => t.split(',').map(s => s.trim())).filter(Boolean)
}

function buildRaw({
  to,
  subject,
  html,
}: {
  to: string[]
  subject: string
  html: string
}): string {
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

  return Buffer.from(mime, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string | string[]
  subject: string
  html?: string
  text?: string
}): Promise<void> {
  const addresses = toAddresses(to)
  if (addresses.length === 0) throw new Error('[Gmail] No recipients provided')

  const body = html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${text ?? ''}</pre>`
  const accessToken = await getAccessToken()
  const raw = buildRaw({ to: addresses, subject, html: body })

  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`[Gmail] Send failed: ${err}`)
  }
}
