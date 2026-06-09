// =====================================================================
// lib/estimate-request-token.ts
// HMAC tokens for the login-free vendor ESTIMATE-REQUEST (RFQ) page.
//
// Each solicited vendor gets a link /vendor/estimate/<token> encoding their
// estimate_request_vendors row id + expiry, so they can accept-to-quote,
// commit a respond-by date, and upload their estimate — no account.
// Mirrors lib/vendor-upload-token.ts (Web Crypto, Edge+Node safe).
// =====================================================================

const SECRET = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const TTL_MS = 45 * 24 * 60 * 60 * 1000   // 45 days
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

interface EstimateReqPayload { erVendorId: string; scope: 'estimate_request'; expiresAt: number }

export async function signEstimateRequestToken(erVendorId: string, ttlMs: number = TTL_MS): Promise<string> {
  const payload: EstimateReqPayload = { erVendorId, scope: 'estimate_request', expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey()
  const sig  = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

/** Verify an estimate-request token → the estimate_request_vendors row id, or null. */
export async function verifyEstimateRequestToken(token: string): Promise<string | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body     = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    const key      = await hmacKey()
    const valid    = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as EstimateReqPayload
    if (payload.scope !== 'estimate_request') return null
    if (payload.expiresAt < Date.now())       return null
    if (!payload.erVendorId)                  return null
    return payload.erVendorId
  } catch {
    return null
  }
}
