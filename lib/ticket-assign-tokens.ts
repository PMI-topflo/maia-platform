// =====================================================================
// lib/ticket-assign-tokens.ts
// HMAC magic-link tokens for the "click to assign" triage email.
//
// Each ticket-needs-assignee email contains a button per staff member,
// with a URL like:
//   /api/tickets/<id>/assign?to=<email>&token=<HMAC>
//
// Clicking validates the token and sets ticket.assignee_email = to.
// Tokens expire after 14 days so abandoned triage emails can't be
// resurrected weeks later. Uses Web Crypto so the same code works in
// both Edge and Node runtimes (mirrors lib/session.ts).
// =====================================================================

const SECRET    = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const TTL_MS    = 14 * 24 * 60 * 60 * 1000  // 14 days
const enc       = new TextEncoder()

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uDecode(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const binary = atob(padded)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw', enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'],
  )
}

interface AssignPayload {
  ticketId:  number
  email:     string
  expiresAt: number
}

export async function signAssignToken(ticketId: number, email: string): Promise<string> {
  const payload: AssignPayload = {
    ticketId,
    email:     email.toLowerCase(),
    expiresAt: Date.now() + TTL_MS,
  }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey()
  const sig  = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

export async function verifyAssignToken(
  token:    string,
  ticketId: number,
  email:    string,
): Promise<boolean> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return false
    const body     = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    const key      = await hmacKey()
    const valid    = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body))
    if (!valid) return false
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as AssignPayload
    if (payload.expiresAt < Date.now())              return false
    if (payload.ticketId !== ticketId)               return false
    if (payload.email !== email.toLowerCase())       return false
    return true
  } catch {
    return false
  }
}
