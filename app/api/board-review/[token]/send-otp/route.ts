// POST /api/board-review/[token]/send-otp   { name: string }
// Sends a 6-digit identity-verification code to the named reviewer's email
// on file for this round. Email only — see lib/board-review-verify.ts for why.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { boardReviewOtpIdentifier } from '@/lib/board-review-verify'
import { maskEmail } from '@/lib/esign-verify'
import { sendEmail } from '@/lib/gmail'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const genOTP = () => String(Math.floor(100000 + Math.random() * 900000))

interface Recipient { name?: string; email?: string; role?: string }

async function loadRound(token: string): Promise<{ id: string; recipients: Recipient[] } | null> {
  const { data } = await supabaseAdmin.from('document_review_rounds')
    .select('id, recipients').eq('token', token).maybeSingle()
  if (!data) return null
  return { id: String(data.id), recipients: Array.isArray(data.recipients) ? data.recipients as Recipient[] : [] }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const round = await loadRound(token)
  if (!round) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  let body: { name?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const name = String(body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Tell us who you are first.' }, { status: 400 })

  const recipient = round.recipients.find(r => (r.name ?? '').trim().toLowerCase() === name.toLowerCase())
  const email = recipient?.email?.trim()
  if (!email) return NextResponse.json({ error: 'No email is on file for you. Please contact PMI.' }, { status: 400 })

  const identifier = boardReviewOtpIdentifier(round.id, name, email)
  const { allowed } = await checkRateLimit(identifier, 'board_review_otp', 5, 60 * 60 * 1000)
  if (!allowed) return NextResponse.json({ error: 'Too many code requests. Please wait a few minutes and try again.' }, { status: 429 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const code = genOTP()
  const { error: dbErr } = await supabaseAdmin.from('otp_verifications').insert({
    identifier, persona: 'board_review', otp_code: code, method: 'board_review_otp',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), ip_address: ip,
  })
  if (dbErr) return NextResponse.json({ error: 'Could not create a code. Please try again.' }, { status: 500 })

  try {
    await sendEmail({
      to: email, subject: 'Your PMI Top Florida board-review verification code',
      html: `<div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px">
        <p style="color:#555;font-size:14px">Your verification code to review and decide on documents:</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:0.2em;color:#f26a1b;text-align:center;padding:20px 0">${code}</div>
        <p style="color:#9ca3af;font-size:12px;text-align:center">Expires in 10 minutes · Do not share this code</p></div>`,
    })
  } catch {
    return NextResponse.json({ error: 'Could not send the code. Please try again or contact PMI.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, sentTo: maskEmail(email) })
}
