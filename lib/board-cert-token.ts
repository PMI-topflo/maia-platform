// =====================================================================
// lib/board-cert-token.ts
// HMAC tokens for the login-free BOARD CERTIFICATION self-upload page.
// Staff emails a board member a link like /board-certification/<token>;
// the token encodes the association + the board member's id + an expiry,
// so the member can upload their DBPR education certificate / signed
// certification form with no account. Web Crypto (Edge + Node safe),
// mirrors lib/owner-portal-token.ts.
// =====================================================================

const SECRET = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const TTL_MS = 60 * 24 * 60 * 60 * 1000   // 60 days — board members are slow
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

interface BoardCertTokenPayload { assoc: string; memberId: string; expiresAt: number }
export interface BoardCertTokenData { assoc: string; memberId: string }

export async function signBoardCertToken(assoc: string, memberId: string, ttlMs: number = TTL_MS): Promise<string> {
  const payload: BoardCertTokenPayload = { assoc, memberId, expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const sig  = await globalThis.crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

export async function verifyBoardCertToken(token: string): Promise<BoardCertTokenData | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body = token.slice(0, dot)
    const ok   = await globalThis.crypto.subtle.verify('HMAC', await hmacKey(), b64uDecode(token.slice(dot + 1)), enc.encode(body))
    if (!ok) return null
    const p = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as BoardCertTokenPayload
    if (p.expiresAt < Date.now() || !p.assoc || !p.memberId) return null
    return { assoc: p.assoc, memberId: p.memberId }
  } catch { return null }
}
