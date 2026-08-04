// =====================================================================
// lib/lease-packet-verify.ts
//
// Verified-signature layer for lease packets. Before a signer's electronic
// signature is recorded, their identity is verified with:
//   • email OTP        — always required
//   • phone OTP        — required when a mobile is on file (SMS or WhatsApp)
//   • geolocation + device — captured with browser consent (IP fallback)
//
// This module holds the pure helpers (types, the namespaced OTP identifier,
// contact masking, and the sign-gating rule). OTP send/verify and the DB
// writes live in the /api/lease-packet/[token]/{send-otp,verify-otp} routes
// and lib/lease-packet.ts.
// =====================================================================

import type { LeasePacketRole } from '@/lib/lease-packet-token'

export type OtpChannel = 'email' | 'sms' | 'whatsapp'

export interface SignGeo {
  lat: number
  lon: number
  accuracy_meters: number
  timestamp_ms: number
}

/** The per-role "verification certificate" stored on the packet and printed
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

/** Namespaced OTP identifier so lease-packet codes never collide with the
 *  login OTPs in the shared otp_verifications table. */
export function leasePacketOtpIdentifier(packetId: string, role: LeasePacketRole, channel: OtpChannel, target: string): string {
  return `lp:${packetId}:${role}:${channel}:${target.trim().toLowerCase()}`
}

/** Mask an email for display: j•••@gmail.com */
export function maskEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim()
  const at = e.indexOf('@')
  if (at < 1) return e || '—'
  const user = e.slice(0, at), dom = e.slice(at)
  return `${user[0]}${'•'.repeat(Math.max(1, user.length - 1))}${dom}`
}

/** Mask a phone for display: •••-•••-1234 */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 4) return phone ? '•••' : '—'
  return `•••-•••-${digits.slice(-4)}`
}

/** The reason a signature is blocked, or null when the signer may sign.
 *  Email OTP is always required; phone OTP is required only when the signer
 *  has a mobile on file — a signer with no number is never blocked on phone. */
export function signatureBlockReason(v: RoleVerification | null | undefined, phoneRequired: boolean): string | null {
  if (!v?.emailVerifiedAt) return 'Please verify your email with the code we sent before signing.'
  if (phoneRequired && !v?.phoneVerifiedAt) return 'Please verify your phone with the code we sent before signing.'
  return null
}
