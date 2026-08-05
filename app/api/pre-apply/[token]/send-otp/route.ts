// POST /api/pre-apply/[token]/send-otp
// Emails the applicant a verification code. They must verify their email before
// uploading documents (so the "who" on the intake is confirmed, not just self-
// declared). Token is the auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveToken } from '@/lib/preapply'
import { maskEmail } from '@/lib/esign-verify'
import { sendEmail } from '@/lib/gmail'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const genOTP = () => String(Math.floor(100000 + Math.random() * 900000))
const identifier = (sid: string, email: string) => `pa:${sid}:email:${email.trim().toLowerCase()}`

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const email = (r.stakeholder.email ?? '').trim()
  if (!email.includes('@')) return NextResponse.json({ error: 'No email on file for you on this application.' }, { status: 400 })

  const id = identifier(r.stakeholder.id, email)
  const { allowed } = await checkRateLimit(id, 'preapply_otp', 5, 60 * 60 * 1000)
  if (!allowed) return NextResponse.json({ error: 'Too many code requests. Please wait a few minutes.' }, { status: 429 })

  const code = genOTP()
  const { error } = await supabaseAdmin.from('otp_verifications').insert({
    identifier: id, persona: 'preapply', otp_code: code, method: 'email',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  if (error) return NextResponse.json({ error: 'Could not create a code. Please try again.' }, { status: 500 })

  try {
    await sendEmail({
      to: email, subject: 'Your application verification code',
      html: `<div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px">
        <p style="color:#555;font-size:14px">Your verification code to continue your application:</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:0.2em;color:#f26a1b;text-align:center;padding:20px 0">${code}</div>
        <p style="color:#9ca3af;font-size:12px;text-align:center">Expires in 10 minutes · Do not share this code</p></div>`,
    })
  } catch { return NextResponse.json({ error: 'Could not send the code. Please contact PMI.' }, { status: 502 }) }

  return NextResponse.json({ ok: true, sentTo: maskEmail(email) })
}
