// POST /api/lease-packet/[token]/send-otp   { channel: 'email' | 'sms' | 'whatsapp' }
// Sends an identity-verification code to the signer for the verified-signature
// layer. Email always available; SMS/WhatsApp only when a mobile is on file.
// Token (role + packet) is the auth. Codes live in the shared otp_verifications
// table under a namespaced identifier so they never collide with login OTPs.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyLeasePacketToken } from '@/lib/lease-packet-token'
import { getLeasePacket, roleEmail, rolePhone } from '@/lib/lease-packet'
import { leasePacketOtpIdentifier, maskEmail, maskPhone, type OtpChannel } from '@/lib/lease-packet-verify'
import { sendSMS, sendWhatsAppOTP } from '@/lib/twilio-send'
import { sendEmail } from '@/lib/gmail'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const genOTP = () => String(Math.floor(100000 + Math.random() * 900000))

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyLeasePacketToken(token)
  if (!t) return NextResponse.json({ error: 'This signing link has expired or is invalid.' }, { status: 401 })

  let body: { channel?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const channel = body.channel as OtpChannel
  if (channel !== 'email' && channel !== 'sms' && channel !== 'whatsapp') {
    return NextResponse.json({ error: 'invalid channel' }, { status: 400 })
  }

  const p = await getLeasePacket(t.packetId)
  if (!p) return NextResponse.json({ error: 'This lease packet could not be found.' }, { status: 404 })
  if (p.status === 'void') return NextResponse.json({ error: 'This lease packet is no longer active.' }, { status: 400 })

  const target = (channel === 'email' ? roleEmail(p, t.role) : rolePhone(p, t.role))?.trim()
  if (!target) return NextResponse.json({ error: `No ${channel === 'email' ? 'email' : 'phone number'} is on file for you. Please contact PMI.` }, { status: 400 })

  const identifier = leasePacketOtpIdentifier(t.packetId, t.role, channel, target)
  const { allowed } = await checkRateLimit(identifier, 'lease_packet_otp', 5, 60 * 60 * 1000)
  if (!allowed) return NextResponse.json({ error: 'Too many code requests. Please wait a few minutes and try again.' }, { status: 429 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const code = genOTP()
  const { error: dbErr } = await supabaseAdmin.from('otp_verifications').insert({
    identifier, persona: 'lease_packet', otp_code: code, method: channel,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), ip_address: ip,
  })
  if (dbErr) return NextResponse.json({ error: 'Could not create a code. Please try again.' }, { status: 500 })

  // SMS/WhatsApp carry an A2P consent ledger entry (best-effort — the signer
  // explicitly requested the code by tapping "send").
  if (channel === 'sms' || channel === 'whatsapp') {
    await supabaseAdmin.from('sms_consents').insert({
      phone: target, opt_in_text: 'Signer requested a lease-packet identity-verification code.',
      source_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/lease-packet`, ip_address: ip,
      user_agent: req.headers.get('user-agent') ?? null, persona: 'lease_packet',
    }).then(() => null, () => null)
  }

  const msg = `Your PMI Top Florida signing verification code is: ${code}\n\nExpires in 10 minutes. Do not share it.`
  let sent = false
  if (channel === 'email') {
    try {
      await sendEmail({
        to: target, subject: 'Your PMI Top Florida signing verification code',
        html: `<div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px">
          <p style="color:#555;font-size:14px">Your verification code to sign the Landlord–Tenant Agreement:</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:0.2em;color:#f26a1b;text-align:center;padding:20px 0">${code}</div>
          <p style="color:#9ca3af;font-size:12px;text-align:center">Expires in 10 minutes · Do not share this code</p></div>`,
      })
      sent = true
    } catch { sent = false }
  } else if (channel === 'whatsapp') {
    try { sent = await sendWhatsAppOTP(target, code) } catch { sent = await sendSMS(target, msg) }
  } else {
    sent = await sendSMS(target, msg)
  }
  if (!sent) return NextResponse.json({ error: 'Could not send the code. Please try another method or contact PMI.' }, { status: 502 })

  return NextResponse.json({ ok: true, sentTo: channel === 'email' ? maskEmail(target) : maskPhone(target) })
}
