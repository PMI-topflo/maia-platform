// =====================================================================
// lib/vendor-upload-token.ts
// HMAC tokens for the login-free VENDOR UPLOAD portal.
//
// Staff (Paola) emails a vendor a link like:
//   /vendor/upload/<token>
// The token encodes the work-order (ticket) id + an expiry, so the vendor
// can upload estimates / invoices / job photos straight onto that one work
// order — no account, scoped to a single WO. Mirrors lib/addon-token.ts
// (Web Crypto, Edge+Node safe).
// =====================================================================

const SECRET = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 days
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

interface VendorUploadPayload {
  ticketId:  number
  scope:     'vendor_upload'
  expiresAt: number
}

export async function signVendorUploadToken(ticketId: number, ttlMs: number = TTL_MS): Promise<string> {
  const payload: VendorUploadPayload = { ticketId, scope: 'vendor_upload', expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey()
  const sig  = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

/** Verify a vendor-upload token. Returns the work-order (ticket) id if
 *  valid + unexpired, else null. */
export async function verifyVendorUploadToken(token: string): Promise<number | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body     = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    const key      = await hmacKey()
    const valid    = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as VendorUploadPayload
    if (payload.scope !== 'vendor_upload') return null
    if (payload.expiresAt < Date.now())    return null
    if (!Number.isFinite(payload.ticketId)) return null
    return payload.ticketId
  } catch {
    return null
  }
}
