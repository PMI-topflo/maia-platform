// =====================================================================
// lib/preregister-token.ts
// HMAC tokens for the login-free PRE-REGISTRATION form.
//
// When an unknown caller reaches MAIA, MAIA texts a link like:
//   /pre-register/<token>
// The token encodes the caller's phone + language + source, so the form
// (and the staff notification) know who to associate the request with —
// no account, short-lived. Mirrors lib/vendor-upload-token.ts (Web Crypto,
// Edge + Node safe).
// =====================================================================

const SECRET = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const TTL_MS = 14 * 24 * 60 * 60 * 1000   // 14 days
const enc    = new TextEncoder()

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
  return globalThis.crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export interface PreregisterPayload {
  phone:     string
  lang:      string
  source:    string          // voice | sms | whatsapp
  scope:     'prereg'
  expiresAt: number
}

export async function signPreregisterToken(
  phone: string, lang = 'en', source = 'voice', ttlMs: number = TTL_MS,
): Promise<string> {
  const payload: PreregisterPayload = { phone, lang, source, scope: 'prereg', expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey()
  const sig  = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

/** Verify a pre-registration token → its payload, or null when invalid/expired. */
export async function verifyPreregisterToken(token: string): Promise<PreregisterPayload | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body     = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    const key      = await hmacKey()
    const valid    = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as PreregisterPayload
    if (payload.scope !== 'prereg')      return null
    if (payload.expiresAt < Date.now())  return null
    if (!payload.phone)                  return null
    return payload
  } catch {
    return null
  }
}
