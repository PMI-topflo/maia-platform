// POST /api/esign/[token]/verify-otp   { channel, code }
// Verifies an identity code and stamps the signer's verification certificate.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyEsignToken } from '@/lib/esign-token'
import { getEsignDoc, roleEmail, rolePhone, setEsignVerification } from '@/lib/esign'
import { esignOtpIdentifier, type OtpChannel, type RoleVerification } from '@/lib/esign-verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyEsignToken(token)
  if (!t) return NextResponse.json({ error: 'This signing link has expired or is invalid.' }, { status: 401 })

  let body: { channel?: string; code?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const channel = body.channel as OtpChannel
  const code = String(body.code ?? '').trim()
  if (channel !== 'email' && channel !== 'sms' && channel !== 'whatsapp') return NextResponse.json({ error: 'invalid channel' }, { status: 400 })
  if (!code) return NextResponse.json({ error: 'Enter the code we sent you.' }, { status: 400 })

  const doc = await getEsignDoc(t.docId)
  if (!doc) return NextResponse.json({ error: 'This document could not be found.' }, { status: 404 })
  const target = (channel === 'email' ? roleEmail(doc, t.role) : rolePhone(doc, t.role))?.trim()
  if (!target) return NextResponse.json({ error: 'Nothing on file to verify.' }, { status: 400 })

  const identifier = esignOtpIdentifier(t.docId, t.role, channel, target)
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

  const now = new Date().toISOString()
  const patch: RoleVerification = channel === 'email'
    ? { email: target, emailVerifiedAt: now }
    : { phone: target, phoneChannel: channel, phoneVerifiedAt: now }
  const v = await setEsignVerification(t.docId, t.role, patch)

  return NextResponse.json({ ok: true, emailVerified: !!v.emailVerifiedAt, phoneVerified: !!v.phoneVerifiedAt })
}
