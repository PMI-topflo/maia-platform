// =====================================================================
// lib/owner-portal-token.ts
// HMAC tokens for the login-free OWNER self-service compliance portal.
// Staff (or the audit cron) emails an owner a link like:
//   /owner/compliance/<token>
// The token encodes the association + the owner's CINC account number + an
// expiry, so the owner can confirm occupancy and upload missing documents
// for their unit — no account. Web Crypto (Edge + Node safe), mirrors
// lib/vendor-upload-token.ts.
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

type PortalScope = 'owner_compliance' | 'tenant_compliance' | 'owner_ledger' | 'owner_ach' | 'owner_ach_confirm'
interface PortalTokenPayload { assoc: string; account: string; scope: PortalScope; expiresAt: number }
export interface OwnerTokenData { assoc: string; account: string }

async function sign(scope: PortalScope, assoc: string, account: string, ttlMs: number): Promise<string> {
  const payload: PortalTokenPayload = { assoc, account, scope, expiresAt: Date.now() + ttlMs }
  const body = b64uEncode(enc.encode(JSON.stringify(payload)))
  const sig  = await globalThis.crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body))
  return `${body}.${b64uEncode(sig)}`
}
async function verify(scope: PortalScope, token: string): Promise<OwnerTokenData | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const body = token.slice(0, dot)
    const ok   = await globalThis.crypto.subtle.verify('HMAC', await hmacKey(), b64uDecode(token.slice(dot + 1)), enc.encode(body))
    if (!ok) return null
    const p = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as PortalTokenPayload
    if (p.scope !== scope || p.expiresAt < Date.now() || !p.assoc || !p.account) return null
    return { assoc: p.assoc, account: p.account }
  } catch { return null }
}

export const signOwnerComplianceToken  = (assoc: string, account: string, ttlMs: number = TTL_MS) => sign('owner_compliance', assoc, account, ttlMs)
export const verifyOwnerComplianceToken = (token: string) => verify('owner_compliance', token)
export const signTenantComplianceToken  = (assoc: string, account: string, ttlMs: number = TTL_MS) => sign('tenant_compliance', assoc, account, ttlMs)
export const verifyTenantComplianceToken = (token: string) => verify('tenant_compliance', token)
// Ledger links are short-lived (7 days) — they expose financial data.
export const signLedgerToken  = (assoc: string, account: string, ttlMs: number = 7 * 24 * 60 * 60 * 1000) => sign('owner_ledger', assoc, account, ttlMs)
export const verifyLedgerToken = (token: string) => verify('owner_ledger', token)
// ACH authorization form — blank form (no sensitive data), 30-day TTL.
export const signAchToken  = (assoc: string, account: string, ttlMs: number = 30 * 24 * 60 * 60 * 1000) => sign('owner_ach', assoc, account, ttlMs)
export const verifyAchToken = (token: string) => verify('owner_ach', token)
// Staff "confirm autopay set up" button → emails the owner. 60-day TTL.
export const signAchConfirmToken  = (assoc: string, account: string, ttlMs: number = 60 * 24 * 60 * 60 * 1000) => sign('owner_ach_confirm', assoc, account, ttlMs)
export const verifyAchConfirmToken = (token: string) => verify('owner_ach_confirm', token)
