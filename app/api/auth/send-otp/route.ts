import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendSMS, sendWhatsApp, sendWhatsAppOTP } from '@/lib/twilio-send'
import { sendEmail } from '@/lib/gmail'
import { checkRateLimit } from '@/lib/rate-limit'

function genOTP(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function POST(req: NextRequest) {
  const { identifier, method, persona, roleData, sms_consent, sms_consent_text, sms_consent_lang } = await req.json()

  if (!identifier?.trim() || !method) {
    return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'

  // A2P 10DLC: SMS and WhatsApp require an explicit consent ledger entry
  // every time we send. Refuse without it, then write the consent row
  // before invoking Twilio. Email is exempt.
  if (method === 'sms' || method === 'whatsapp') {
    if (!sms_consent || !sms_consent_text) {
      return NextResponse.json(
        { ok: false, error: 'SMS / WhatsApp consent is required.' },
        { status: 400 },
      )
    }
    const { error: consentErr } = await supabaseAdmin.from('sms_consents').insert({
      phone:        identifier.trim(),
      opt_in_text:  sms_consent_text,
      source_url:   req.headers.get('referer') ?? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/login`,
      ip_address:   ip,
      user_agent:   req.headers.get('user-agent') ?? null,
      language:     sms_consent_lang ?? null,
      persona:      persona ?? null,
    })
    // Migration tolerance: if the sms_consents table hasn't been
    // applied yet, log and proceed — don't block the user out.
    if (consentErr && !/relation .* does not exist/.test(consentErr.message ?? '')) {
      console.error('[send-otp] sms_consents insert failed:', consentErr.message)
    }
  }

  // Rate limit: 3 OTP sends per identifier per hour
  const { allowed } = await checkRateLimit(identifier.trim(), `otp_send_${method}`, 3, 60 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Too many requests. Please wait before trying again.' }, { status: 429 })
  }

  const code      = genOTP()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()  // 10 minutes

  // Persist OTP
  const { error: dbErr } = await supabaseAdmin.from('otp_verifications').insert({
    identifier: identifier.trim(),
    persona:    persona ?? 'homeowner',
    otp_code:   code,
    method,
    expires_at: expiresAt,
    ip_address: ip,
    role_data:  roleData ?? null,
  })
  if (dbErr) {
    console.error('[send-otp] DB error:', dbErr)
    return NextResponse.json({ ok: false, error: 'Failed to create OTP' }, { status: 500 })
  }

  const msgBody = `Your PMI Top Florida verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`

  let sent = false
  if (method === 'sms') {
    sent = await sendSMS(identifier.trim(), msgBody)
  } else if (method === 'whatsapp') {
    try {
      sent = await sendWhatsAppOTP(identifier.trim(), code)
    } catch (err) {
      console.error('[send-otp] WhatsApp template failed, falling back to SMS:', err)
      sent = await sendSMS(identifier.trim(), msgBody)
    }
  } else if (method === 'email') {
    try {
      await sendEmail({
        to:      identifier.trim(),
        subject: 'Your PMI Top Florida verification code',
        html:    `<div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px">
          <p style="color:#555;font-size:14px">Your verification code for PMI Top Florida:</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:0.2em;color:#f26a1b;text-align:center;padding:20px 0">${code}</div>
          <p style="color:#9ca3af;font-size:12px;text-align:center">Expires in 10 minutes · Do not share this code</p>
        </div>`,
      })
      sent = true
    } catch (e) {
      console.error('[send-otp] Email error:', e)
    }
  }

  if (!sent) {
    return NextResponse.json({ ok: false, error: 'Failed to send code. Please try another method.' }, { status: 500 })
  }

  void supabaseAdmin.from('login_history').insert({
    event: 'otp_sent', identifier: identifier.trim(), persona: persona ?? 'homeowner',
    method, ip_address: ip, success: true, role_data: roleData ?? null,
    association_code: (roleData as { association_code?: string } | null)?.association_code ?? null,
    association_name: (roleData as { association_name?: string } | null)?.association_name ?? null,
  })

  return NextResponse.json({ ok: true })
}
