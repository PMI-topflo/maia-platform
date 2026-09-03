// POST /api/pre-apply/[token]/send-otp
// Sends the applicant a verification code before they can upload documents
// (so the "who" on the intake is confirmed, not just self-declared). Email
// when the stakeholder has one on file; otherwise SMS/WhatsApp to their phone
// -- built for the person with no email address / not comfortable online,
// same channel their invite link itself would have gone out on. Token auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveToken } from '@/lib/preapply'
import { maskEmail, maskPhone } from '@/lib/esign-verify'
import { sendEmail } from '@/lib/gmail'
import { sendSMS, sendWhatsAppOTP } from '@/lib/twilio-send'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const genOTP = () => String(Math.floor(100000 + Math.random() * 900000))
const identifier = (sid: string, channel: string, target: string) => `pa:${sid}:${channel}:${target.trim().toLowerCase()}`

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  const email = (r.stakeholder.email ?? '').trim()
  const phone = (r.stakeholder.phone ?? '').trim()
  const channel: 'email' | 'whatsapp' = email.includes('@') ? 'email' : 'whatsapp'
  const target = channel === 'email' ? email : phone
  if (!target) return NextResponse.json({ error: 'No email or phone on file for you on this application. Please contact PMI.' }, { status: 400 })

  const id = identifier(r.stakeholder.id, channel, target)
  const { allowed } = await checkRateLimit(id, 'preapply_otp', 5, 60 * 60 * 1000)
  if (!allowed) return NextResponse.json({ error: 'Too many code requests. Please wait a few minutes.' }, { status: 429 })

  const code = genOTP()
  const { error } = await supabaseAdmin.from('otp_verifications').insert({
    identifier: id, persona: 'preapply', otp_code: code, method: channel,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  if (error) return NextResponse.json({ error: 'Could not create a code. Please try again.' }, { status: 500 })

  if (channel === 'whatsapp') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    await supabaseAdmin.from('sms_consents').insert({
      phone: target, opt_in_text: 'Applicant requested a pre-application identity-verification code.',
      source_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/pre-apply`, ip_address: ip,
      user_agent: req.headers.get('user-agent') ?? null, persona: 'preapply',
    }).then(() => null, () => null)
  }

  let sent = false
  if (channel === 'email') {
    try {
      await sendEmail({
        to: email, subject: 'Your application verification code',
        html: `<div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px">
          <p style="color:#555;font-size:14px">Your verification code to continue your application:</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:0.2em;color:#f26a1b;text-align:center;padding:20px 0">${code}</div>
          <p style="color:#9ca3af;font-size:12px;text-align:center">Expires in 10 minutes · Do not share this code</p></div>`,
      })
      sent = true
    } catch { sent = false }
  } else {
    const msg = `Your PMI Top Florida application verification code is: ${code}\n\nExpires in 10 minutes. Do not share it.`
    try { sent = await sendWhatsAppOTP(target, code) } catch { sent = await sendSMS(target, msg) }
  }
  if (!sent) return NextResponse.json({ error: 'Could not send the code. Please contact PMI.' }, { status: 502 })

  return NextResponse.json({ ok: true, channel, sentTo: channel === 'email' ? maskEmail(target) : maskPhone(target) })
}
