// =====================================================================
// lib/vendor-onboarding-token.ts
// HMAC tokens for the login-free VENDOR ONBOARDING portal.
//
// Staff (Paola) onboards a brand-new vendor; MAIA emails a link like:
//   /vendor/onboard/<token>
// The token encodes the vendor_onboarding row id + an expiry, so the
// vendor can provide their W-9, ACH, COI and (if needed) license straight
// against their just-created CINC vendor — no account, no work order
// required. Mirrors lib/vendor-upload-token.ts (Web Crypto, Edge+Node safe).
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

interface VendorOnboardingPayload {
  onboardingId: string
  scope:        'vendor_onboarding'
  expiresAt:    number
}

export async function signVendorOnboardingToken(onboardingId: string, ttlMs: number = TTL_MS): Promise<string> {
  const payload: VendorOnboardingPayload = { onboardingId, scope: 'vendor_onboarding', expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey()
  const sig  = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

/** Verify a vendor-onboarding token. Returns the onboarding row id (uuid) if
 *  valid + unexpired, else null. */
export async function verifyVendorOnboardingToken(token: string): Promise<string | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body     = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    const key      = await hmacKey()
    const valid    = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as VendorOnboardingPayload
    if (payload.scope !== 'vendor_onboarding') return null
    if (payload.expiresAt < Date.now())        return null
    if (typeof payload.onboardingId !== 'string' || !payload.onboardingId) return null
    return payload.onboardingId
  } catch {
    return null
  }
}
