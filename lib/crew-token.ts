// =====================================================================
// lib/crew-token.ts
// HMAC tokens that identify ONE vendor crew member (vendor_employees.id).
//
// The vendor upload link is per-work-order and shared by the whole crew,
// so it can't tell who is viewing. We append a separate signed crew token
// (?e=<token>) per recipient when we send the link, so the upload page can
// offer "save this language as my default" — writing to that employee's
// vendor_employees.preferred_language. Web Crypto (Edge + Node safe);
// mirrors lib/vendor-upload-token.ts.
// =====================================================================

const SECRET = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 days — matches the upload token
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

interface CrewPayload {
  employeeId: string
  scope:      'crew'
  expiresAt:  number
}

export async function signCrewToken(employeeId: string, ttlMs: number = TTL_MS): Promise<string> {
  const payload: CrewPayload = { employeeId, scope: 'crew', expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey()
  const sig  = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

/** Verify a crew token. Returns the employee id if valid + unexpired, else null. */
export async function verifyCrewToken(token: string): Promise<string | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body     = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    const key      = await hmacKey()
    const valid    = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as CrewPayload
    if (payload.scope !== 'crew')        return null
    if (payload.expiresAt < Date.now())  return null
    if (!payload.employeeId)             return null
    return payload.employeeId
  } catch {
    return null
  }
}
