// Uses globalThis.crypto.subtle (Web Crypto API) so this module works in
// both the Edge runtime (Next.js middleware) and the Node.js runtime (API routes).
// Node.js crypto is NOT available in the Edge runtime — never import it here.

const SECRET     = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

const enc = new TextEncoder()
const dec = new TextDecoder()

export interface SessionData {
  userId:          string | number
  persona:         'owner' | 'board' | 'staff' | 'tenant' | 'unit_manager' | 'building_manager'
  associationCode: string
  displayName:     string
  contactName:     string
  issuedAt:        number
  expiresAt:       number
}

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uDecode(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded  = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const binary  = atob(padded)
  const bytes   = new Uint8Array(binary.length)
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

export async function signSession(data: SessionData): Promise<string> {
  const payload = b64uEncode(enc.encode(JSON.stringify(data)))
  const key     = await hmacKey()
  const sig     = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return `${payload}.${b64uEncode(sig)}`
}

export async function verifySession(token: string): Promise<SessionData | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const payload  = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    const key      = await hmacKey()
    const valid    = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload))
    if (!valid) return null
    const data = JSON.parse(dec.decode(b64uDecode(payload))) as SessionData
    if (data.expiresAt < Date.now()) return null
    return data
  } catch { return null }
}

export function makeSession(data: Omit<SessionData, 'issuedAt' | 'expiresAt'>): SessionData {
  const now = Date.now()
  return { ...data, issuedAt: now, expiresAt: now + THIRTY_DAYS }
}

export const SESSION_COOKIE  = 'maia_session'
export const COOKIE_MAX_AGE  = 60 * 60 * 24 * 30  // 30 days in seconds
