// POST /api/board-review/[token]/verify-otp   { name: string; code: string }
// Verifies the code and stamps this reviewer verified for this round —
// valid REVIEWER_VERIFICATION_DAYS (lib/board-review-verify.ts).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { boardReviewOtpIdentifier, withReviewerVerified, type ReviewerVerifications } from '@/lib/board-review-verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Recipient { name?: string; email?: string; role?: string }

async function loadRound(token: string): Promise<{ id: string; recipients: Recipient[]; verifications: ReviewerVerifications } | null> {
  const { data } = await supabaseAdmin.from('document_review_rounds')
    .select('id, recipients, reviewer_verifications').eq('token', token).maybeSingle()
  if (!data) return null
  return {
    id: String(data.id),
    recipients: Array.isArray(data.recipients) ? data.recipients as Recipient[] : [],
    verifications: (data.reviewer_verifications as ReviewerVerifications | null) ?? {},
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const round = await loadRound(token)
  if (!round) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  let body: { name?: string; code?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const name = String(body.name ?? '').trim()
  const code = String(body.code ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Tell us who you are first.' }, { status: 400 })
  if (!code) return NextResponse.json({ error: 'Enter the code we sent you.' }, { status: 400 })

  const recipient = round.recipients.find(r => (r.name ?? '').trim().toLowerCase() === name.toLowerCase())
  const email = recipient?.email?.trim()
  if (!email) return NextResponse.json({ error: 'No email is on file for you. Please contact PMI.' }, { status: 400 })

  const identifier = boardReviewOtpIdentifier(round.id, name, email)
  const { data: rows } = await supabaseAdmin.from('otp_verifications')
    .select('id, otp_code, attempts')
    .eq('identifier', identifier).is('verified_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1)
  const otp = rows?.[0]
  if (!otp) return NextResponse.json({ error: 'No active code — please request a new one.' }, { status: 400 })

  await supabaseAdmin.from('otp_verifications').update({ attempts: otp.attempts + 1 }).eq('id', otp.id)
  if (otp.attempts >= 5) return NextResponse.json({ error: 'Too many incorrect attempts. Request a new code.' }, { status: 429 })
  if (otp.otp_code !== code) return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 })

  await supabaseAdmin.from('otp_verifications').update({ verified_at: new Date().toISOString() }).eq('id', otp.id)

  const nextVerifications = withReviewerVerified(round.verifications, name, email)
  const { error } = await supabaseAdmin.from('document_review_rounds')
    .update({ reviewer_verifications: nextVerifications }).eq('id', round.id)
  if (error) return NextResponse.json({ error: 'Verified, but could not save — please try again.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
