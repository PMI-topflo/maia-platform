// =====================================================================
// lib/application-token.ts
// HMAC token for a leasing/sale-application STAKEHOLDER (listing agent, owner,
// applicant agent, applicant). Encodes the stakeholder row id + the row's
// token_nonce so a link can be revoked by rotating the nonce. Edge + Node safe
// (Web Crypto), mirrors lib/owner-portal-token.ts.
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

interface Payload { sid: string; nonce: string; expiresAt: number }
export interface ApplicationTokenData { stakeholderId: string; nonce: string }

export async function signApplicationToken(stakeholderId: string, nonce: string, ttlMs: number = TTL_MS): Promise<string> {
  const payload: Payload = { sid: stakeholderId, nonce, expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const sig  = await globalThis.crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

export async function verifyApplicationToken(token: string): Promise<ApplicationTokenData | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body = token.slice(0, dot)
    const ok   = await globalThis.crypto.subtle.verify('HMAC', await hmacKey(), b64uDecode(token.slice(dot + 1)), enc.encode(body))
    if (!ok) return null
    const p = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as Payload
    if (p.expiresAt < Date.now() || !p.sid || !p.nonce) return null
    return { stakeholderId: p.sid, nonce: p.nonce }
  } catch { return null }
}
