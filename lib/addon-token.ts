// =====================================================================
// lib/addon-token.ts
// HMAC bearer tokens for the Gmail Workspace add-on.
//
// The add-on (Apps Script) calls Maia's /api/addon/* endpoints server-
// to-server (UrlFetchApp), so it can't reuse the browser session cookie.
// Instead each staff member pastes a long-lived token (minted on the
// /admin/addon page) into the add-on once; every request carries it as
// `Authorization: Bearer <token>`.
//
// The token simply authenticates "this is staff member <email>". Mirrors
// lib/ticket-assign-tokens.ts (Web Crypto, Edge+Node safe). Rotate by
// re-minting on /admin/addon; old tokens expire after TTL_MS.
// =====================================================================

// Add-on tokens are signed with a DEDICATED secret when one is set, so that
// rotating MAIA_SESSION_SECRET (a routine security action) no longer silently
// invalidates every staffer's Gmail sidebar token — which is exactly what
// happened on 2026-07-12 and left Paola "unauthorized" for weeks. Verification
// accepts either secret, so existing session-secret-signed tokens keep working
// during the transition; new tokens use the dedicated secret and survive future
// session-secret rotations. Set ADDON_TOKEN_SECRET to a stable random value.
const SESSION_SECRET = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const ADDON_SECRET   = process.env.ADDON_TOKEN_SECRET || null
const SIGN_SECRET    = ADDON_SECRET ?? SESSION_SECRET
// Secrets to try when verifying (deduped): the dedicated one first, then the
// session secret for backward compatibility.
const VERIFY_SECRETS = [...new Set([SIGN_SECRET, SESSION_SECRET])]
const TTL_MS = 365 * 24 * 60 * 60 * 1000   // 1 year — staff use it daily
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

async function hmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'],
  )
}

interface AddonPayload {
  email:     string
  scope:     'addon'
  expiresAt: number
}

export async function signAddonToken(email: string): Promise<string> {
  const payload: AddonPayload = { email: email.toLowerCase(), scope: 'addon', expiresAt: Date.now() + TTL_MS }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey(SIGN_SECRET)
  const sig  = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

/** Verify a bearer token. Returns the staff email if valid + unexpired,
 *  else null. Accepts a signature from any configured secret (dedicated or
 *  session) so tokens survive a session-secret rotation. */
export async function verifyAddonToken(token: string): Promise<string | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body     = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    let valid = false
    for (const secret of VERIFY_SECRETS) {
      if (await globalThis.crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(body))) { valid = true; break }
    }
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as AddonPayload
    if (payload.scope !== 'addon')      return null
    if (payload.expiresAt < Date.now()) return null
    if (!payload.email)                 return null
    return payload.email
  } catch {
    return null
  }
}

/** Pull the bearer token from an incoming request (Authorization header
 *  or ?token= fallback) and resolve it to a staff email, or null. */
export async function addonStaffEmail(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') ?? ''
  const m = header.match(/^Bearer\s+(.+)$/i)
  const token = m ? m[1].trim() : new URL(req.url).searchParams.get('token')
  if (!token) return null
  return verifyAddonToken(token)
}
