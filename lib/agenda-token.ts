// =====================================================================
// lib/agenda-token.ts
// HMAC token for the vendor-office "confirm next week's agenda" link
// (Friday email). Scoped to one recurring_service. Mirrors the other
// HMAC token helpers (Web Crypto, Edge+Node safe).
// =====================================================================

const SECRET = process.env.MAIA_SESSION_SECRET ?? 'maia-dev-secret-change-in-prod'
const TTL_MS = 21 * 24 * 60 * 60 * 1000   // 21 days
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

interface AgendaPayload { serviceId: number; scope: 'agenda'; expiresAt: number }

export async function signAgendaToken(serviceId: number): Promise<string> {
  const payload: AgendaPayload = { serviceId, scope: 'agenda', expiresAt: Date.now() + TTL_MS }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey()
  const sig  = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}

export async function verifyAgendaToken(token: string): Promise<number | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body     = token.slice(0, dot)
    const sigBytes = b64uDecode(token.slice(dot + 1))
    const key      = await hmacKey()
    if (!(await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body)))) return null
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as AgendaPayload
    if (payload.scope !== 'agenda' || payload.expiresAt < Date.now() || !Number.isFinite(payload.serviceId)) return null
    return payload.serviceId
  } catch {
    return null
  }
}
