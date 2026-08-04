// =====================================================================
// lib/esign-verify.ts
//
// The shared verified-signature layer for the association e-sign engine.
// Generalized from the lease-packet verification (lib/lease-packet-verify):
// before any signer's signature is recorded, identity is verified with
//   • email OTP        — always required
//   • phone OTP        — required when a mobile is on file (SMS or WhatsApp)
//   • geolocation + device — captured with browser consent (IP fallback)
//
// Pure helpers only (types, the namespaced OTP identifier, contact masking,
// the sign-gating rule). OTP send/verify + DB writes live in the generic
// /api/esign/[token]/* routes and lib/esign.ts.
// =====================================================================

export type OtpChannel = 'email' | 'sms' | 'whatsapp'

export interface SignGeo {
  lat: number
  lon: number
  accuracy_meters: number
  timestamp_ms: number
}

/** The per-signer verification certificate stored on the document and printed
 *  on the signed PDF. */
export interface RoleVerification {
  email?: string | null
  emailVerifiedAt?: string | null
  phone?: string | null
  phoneChannel?: 'sms' | 'whatsapp' | null
  phoneVerifiedAt?: string | null
  geo?: SignGeo | { denied: true } | null
  ip?: string | null
  ua?: string | null
}

/** Namespaced OTP identifier so e-sign codes never collide with login OTPs
 *  (or lease-packet codes) in the shared otp_verifications table. */
export function esignOtpIdentifier(docId: string, role: string, channel: OtpChannel, target: string): string {
  return `es:${docId}:${role}:${channel}:${target.trim().toLowerCase()}`
}

/** Mask an email for display: j•••@gmail.com */
export function maskEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim()
  const at = e.indexOf('@')
  if (at < 1) return e || '—'
  return `${e[0]}${'•'.repeat(Math.max(1, at - 1))}${e.slice(at)}`
}

/** Mask a phone for display: •••-•••-1234 */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 4) return phone ? '•••' : '—'
  return `•••-•••-${digits.slice(-4)}`
}

/** The reason a signature is blocked, or null when the signer may sign. Email
 *  OTP is always required; phone OTP only when a mobile is on file. */
export function signatureBlockReason(v: RoleVerification | null | undefined, phoneRequired: boolean): string | null {
  if (!v?.emailVerifiedAt) return 'Please verify your email with the code we sent before signing.'
  if (phoneRequired && !v?.phoneVerifiedAt) return 'Please verify your phone with the code we sent before signing.'
  return null
}
