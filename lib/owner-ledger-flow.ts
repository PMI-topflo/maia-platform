// =====================================================================
// lib/owner-ledger-flow.ts
// Helpers for the owner "send me my ledger" self-service flow (the state
// machine lives in the webhook; these are the pure side-effects):
//   • resolveOwnerUnits   — the owner's unit(s) for a phone number
//   • isPhoneVerified / markPhoneVerified — the "OTP once, then remember" gate
//   • sendLedgerOtp / verifyLedgerOtp     — one-time code to the email on file
//   • deliverLedger       — sign a token per unit + send the secure PDF link
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { sendSMS, sendWhatsApp } from '@/lib/twilio-send'
import { signLedgerToken } from '@/lib/owner-portal-token'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export interface OwnerUnit {
  account:         string
  assoc:           string
  associationName: string
  unit:            string | null
  address:         string | null
  ownerName:       string
  email:           string | null
}

function phoneVariants(phone: string): string[] {
  const clean = phone.replace(/\D/g, '')
  return [phone, '+' + clean, clean.replace(/^1/, '')]
}

function firstEmail(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const m = s.split(/[,;\s]+/).map(x => x.trim()).find(x => x.includes('@'))
  return m ?? null
}

/** Every owner unit registered to this phone (across phone / phone_2 / phone_e164). */
export async function resolveOwnerUnits(phone: string): Promise<OwnerUnit[]> {
  const v = phoneVariants(phone)
  const orClause = [
    ...v.map(p => `phone.eq.${p}`),
    ...v.map(p => `phone_2.eq.${p}`),
    ...v.map(p => `phone_e164.eq.${p}`),
  ].join(',')
  const { data } = await supabaseAdmin.from('owners')
    .select('account_number, association_code, association_name, unit_number, address, first_name, last_name, entity_name, emails')
    .or(orClause)
  const seen = new Set<string>()
  const units: OwnerUnit[] = []
  for (const o of data ?? []) {
    const account = String(o.account_number ?? '').trim()
    const assoc   = String(o.association_code ?? '').trim()
    if (!account || !assoc) continue
    const key = `${assoc}|${account}`
    if (seen.has(key)) continue
    seen.add(key)
    units.push({
      account, assoc,
      associationName: String(o.association_name ?? '') || assoc,
      unit:    o.unit_number ? String(o.unit_number) : null,
      address: o.address ? String(o.address) : null,
      ownerName: String(o.entity_name ?? '') || `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim() || 'Owner',
      email:   firstEmail(o.emails),
    })
  }
  return units
}

// ── "OTP once, then remember" ────────────────────────────────────────
export async function isPhoneVerified(phone: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin.from('ledger_verified_phones')
      .select('phone').in('phone', phoneVariants(phone)).limit(1).maybeSingle()
    return !!data
  } catch { return false }
}

export async function markPhoneVerified(phone: string, account: string): Promise<void> {
  try {
    await supabaseAdmin.from('ledger_verified_phones')
      .upsert({ phone, account_number: account, verified_at: new Date().toISOString() }, { onConflict: 'phone' })
  } catch (err) { console.error('[ledger] markPhoneVerified failed:', err instanceof Error ? err.message : err) }
}

// ── One-time code to the email on file ───────────────────────────────
const genOtp = () => String(Math.floor(100000 + ((Date.now() * 9301 + 49297) % 233280) / 233280 * 900000)).slice(0, 6)

/** Send a 6-digit code to `email`. Returns the masked email on success. */
export async function sendLedgerOtp(email: string): Promise<{ ok: boolean; masked?: string }> {
  const code = genOtp()
  const { error } = await supabaseAdmin.from('otp_verifications').insert({
    identifier: email.trim().toLowerCase(),
    persona:    'homeowner',
    otp_code:   code,
    method:     'email',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  if (error) { console.error('[ledger] OTP insert failed:', error.message); return { ok: false } }
  try {
    await sendEmail({
      to: email.trim(),
      subject: `Your PMI verification code: ${code}`,
      html: `<p>Your PMI Top Florida Properties verification code is:</p>
        <p style="font-size:26px;font-weight:700;letter-spacing:3px;color:#f26a1b">${code}</p>
        <p style="color:#6b7280;font-size:13px">It expires in 10 minutes. You requested your account statement by message. If this wasn't you, ignore this email.</p>`,
    })
  } catch (err) { console.error('[ledger] OTP email failed:', err instanceof Error ? err.message : err); return { ok: false } }
  const [u, d] = email.split('@')
  return { ok: true, masked: `${u.slice(0, 2)}***@${d}` }
}

/** Check a code against the latest unexpired, unverified OTP for `email`. */
export async function verifyLedgerOtp(email: string, code: string): Promise<boolean> {
  const id = email.trim().toLowerCase()
  const { data: otp } = await supabaseAdmin.from('otp_verifications')
    .select('id, otp_code, expires_at')
    .eq('identifier', id).is('verified_at', null).gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false }).limit(1).maybeSingle()
  if (!otp || otp.otp_code !== code.trim()) return false
  await supabaseAdmin.from('otp_verifications').update({ verified_at: new Date().toISOString() }).eq('id', otp.id)
  return true
}

// ── Deliver the secure PDF link ──────────────────────────────────────
export type DeliveryMethod = 'email' | 'whatsapp' | 'sms'

/** Sign a 7-day token per unit and send the statement link via the chosen
 *  channel. Returns a short status note for the conversation. */
export async function deliverLedger(opts: {
  units:   OwnerUnit[]
  method:  DeliveryMethod
  toPhone: string
  toEmail?: string | null
}): Promise<{ ok: boolean; note: string }> {
  const links = await Promise.all(opts.units.map(async u => {
    const token = await signLedgerToken(u.assoc, u.account)
    const label = u.unit ? `Unit ${u.unit}` : u.account
    return { label, url: `${APP}/api/owner/ledger/${token}` }
  }))

  const lines = links.map(l => `${l.label}: ${l.url}`).join('\n')
  const intro = links.length > 1 ? 'Here are your account statements:' : 'Here is your account statement:'

  if (opts.method === 'email') {
    const email = opts.toEmail || opts.units.find(u => u.email)?.email
    if (!email) return { ok: false, note: 'no_email' }
    const html = `<p>${intro}</p>${links.map(l => `<p><a href="${l.url}" style="color:#f26a1b;font-weight:600">${l.label} — view statement (PDF)</a></p>`).join('')}<p style="color:#9ca3af;font-size:12px">Link expires in 7 days.</p>`
    await sendEmail({ to: email, subject: 'Your PMI account statement', html })
    return { ok: true, note: `email:${email}` }
  }

  const body = `${intro}\n${lines}\n\n(Link expires in 7 days.)`
  if (opts.method === 'whatsapp') { await sendWhatsApp(opts.toPhone, body); return { ok: true, note: 'whatsapp' } }
  await sendSMS(opts.toPhone, body)
  return { ok: true, note: 'sms' }
}
