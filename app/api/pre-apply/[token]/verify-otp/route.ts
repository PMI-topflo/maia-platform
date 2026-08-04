// POST /api/pre-apply/[token]/verify-otp   { code }
// Verifies the applicant's email code and unlocks document upload.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPreApplyToken } from '@/lib/preapply-token'
import { getIntake, markEmailVerified } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const identifier = (id: string, email: string) => `pa:${id}:email:${email.trim().toLowerCase()}`

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyPreApplyToken(token)
  if (!t) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  let b: { code?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const code = String(b.code ?? '').trim()
  if (!code) return NextResponse.json({ error: 'Enter the code we emailed you.' }, { status: 400 })

  const intake = await getIntake(t.applicationId)
  if (!intake) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const email = (intake.applicant?.email ?? '').trim()
  if (!email.includes('@')) return NextResponse.json({ error: 'Nothing to verify.' }, { status: 400 })

  const id = identifier(t.applicationId, email)
  const { data: rows } = await supabaseAdmin.from('otp_verifications')
    .select('id, otp_code, attempts').eq('identifier', id).is('verified_at', null)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1)
  const otp = rows?.[0]
  if (!otp) return NextResponse.json({ error: 'No active code — please request a new one.' }, { status: 400 })

  await supabaseAdmin.from('otp_verifications').update({ attempts: otp.attempts + 1 }).eq('id', otp.id)
  if (otp.attempts >= 5) return NextResponse.json({ error: 'Too many incorrect attempts. Request a new code.' }, { status: 429 })
  if (otp.otp_code !== code) return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 })

  await supabaseAdmin.from('otp_verifications').update({ verified_at: new Date().toISOString() }).eq('id', otp.id)
  await markEmailVerified(t.applicationId)
  return NextResponse.json({ ok: true, emailVerified: true })
}
