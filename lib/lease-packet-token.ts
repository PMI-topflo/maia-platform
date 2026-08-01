// =====================================================================
// lib/lease-packet-token.ts
// HMAC tokens for the login-free lease-packet e-signature links. Staff
// send the owner and the tenant each a link like:
//   /lease-packet/<token>
// The token encodes the packet id + the signer's role (owner | tenant)
// + an expiry, so each party can review and e-sign the Landlord–Tenant
// Agreement for their unit — no account. Web Crypto (Edge + Node safe),
// mirrors lib/owner-portal-token.ts.
// =====================================================================

const SECRET = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const TTL_MS = 45 * 24 * 60 * 60 * 1000   // 45 days
const enc    = new TextEncoder()

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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

export type LeasePacketRole = 'owner' | 'tenant'
interface LeasePacketTokenPayload { packetId: string; role: LeasePacketRole; expiresAt: number }
export interface LeasePacketTokenData { packetId: string; role: LeasePacketRole }

export async function signLeasePacketToken(packetId: string, role: LeasePacketRole, ttlMs: number = TTL_MS): Promise<string> {
  const payload: LeasePacketTokenPayload = { packetId, role, expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const sig  = await globalThis.crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

export async function verifyLeasePacketToken(token: string): Promise<LeasePacketTokenData | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body = token.slice(0, dot)
    const ok   = await globalThis.crypto.subtle.verify('HMAC', await hmacKey(), b64uDecode(token.slice(dot + 1)), enc.encode(body))
    if (!ok) return null
    const p = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as LeasePacketTokenPayload
    if (p.expiresAt < Date.now() || !p.packetId || (p.role !== 'owner' && p.role !== 'tenant')) return null
    return { packetId: p.packetId, role: p.role }
  } catch { return null }
}
