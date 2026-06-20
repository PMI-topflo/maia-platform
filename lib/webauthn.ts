// =====================================================================
// lib/webauthn.ts
//
// Passkey (WebAuthn) config + challenge-cookie helpers for resident login.
//
// Passkeys layer ON TOP of the existing phone-OTP + maia_session system —
// they do NOT replace it. A successful passkey login re-issues the SAME
// `maia_session` HMAC cookie that the OTP flow issues (see lib/session.ts),
// so the rest of the app (middleware, gates) is unchanged. The verification
// itself runs in API routes on the Node.js runtime (@simplewebauthn/server).
// =====================================================================

export const RP_DISPLAY_NAME = 'Maia — PMI Top Florida Properties'

// Relying Party ID = the registrable domain. ⚠️ EFFECTIVELY PERMANENT: once
// users enroll, changing the RP ID invalidates every existing passkey.
// Production = pmitop.com (www is a subdomain, so it's a valid origin).
// On localhost, WebAuthn requires the RP ID to equal 'localhost', so dev uses
// that — this never affects production enrollments.
export const PROD_RP_ID = 'pmitop.com'
export const PROD_ORIGINS = ['https://pmitop.com', 'https://www.pmitop.com']

export interface RpContext { rpID: string; origins: string[] }

// A handful of common authenticator AAGUIDs → human names, so an enrolled
// passkey reads "iCloud Keychain" etc. Unknown → a generic label.
const AAGUID_NAMES: Record<string, string> = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
}

/** Friendly name for an authenticator AAGUID. */
export function aaguidName(aaguid: string | null | undefined): string {
  if (aaguid && AAGUID_NAMES[aaguid]) return AAGUID_NAMES[aaguid]
  return 'Passkey'
}

/** Derive the RP ID + allowed origins from the request's Origin header so the
 *  same code path works on localhost (dev) and pmitop.com (prod). */
export function rpContextFromOrigin(origin: string | null): RpContext {
  try {
    const host = origin ? new URL(origin).hostname : ''
    if (host === 'localhost' || host === '127.0.0.1') {
      return { rpID: 'localhost', origins: ['http://localhost:3000'] }
    }
  } catch { /* fall through to prod */ }
  return { rpID: PROD_RP_ID, origins: PROD_ORIGINS }
}

// ── Challenge cookie (short-lived, HMAC-signed) ──────────────────────────
// WebAuthn requires the server-issued challenge to be remembered between
// "generate options" and "verify". We stash it in a signed, HttpOnly cookie
// (same HMAC secret as the session) rather than a table — no cleanup needed.

export const CHALLENGE_COOKIE = 'maia_pk_challenge'
export const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const SECRET = process.env['MAIA_SESSION_SECRET'] ?? 'maia-dev-secret-change-in-prod'
const enc = new TextEncoder()
const dec = new TextDecoder()

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uDecode(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
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

/** Sign a challenge into a cookie value (challenge + expiry, HMAC-signed). */
export async function signChallenge(challenge: string): Promise<string> {
  const payload = b64uEncode(enc.encode(JSON.stringify({ c: challenge, e: Date.now() + CHALLENGE_TTL_MS })))
  const sig = await globalThis.crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(payload))
  return `${payload}.${b64uEncode(sig)}`
}

/** Verify + extract the challenge from a cookie value; null if invalid/expired. */
export async function readChallenge(token: string | undefined | null): Promise<string | null> {
  if (!token) return null
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const payload = token.slice(0, dot)
    const sig = b64uDecode(token.slice(dot + 1))
    const ok = await globalThis.crypto.subtle.verify('HMAC', await hmacKey(), sig, enc.encode(payload))
    if (!ok) return null
    const { c, e } = JSON.parse(dec.decode(b64uDecode(payload))) as { c: string; e: number }
    if (!c || e < Date.now()) return null
    return c
  } catch { return null }
}
