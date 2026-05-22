// =====================================================================
// POST /api/sms-opt-in
//
// Receives a submission from the public SMS opt-in webform
// (/sms-opt-in). When the user ticked the SMS-consent box, a row is
// written to the sms_consents ledger — the A2P 10DLC proof of opt-in.
// The form submits whether or not the consent box was ticked, so a
// submission without consent is accepted and simply records nothing.
// =====================================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { SMS_OPTIN_TEXT } from '@/lib/sms-optin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Normalise a US phone number to E.164 (+1XXXXXXXXXX) when possible. */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.trim()
}

export async function POST(req: Request) {
  let body: {
    first_name?: string; last_name?: string
    phone?: string; email?: string
    sms_consent?: unknown
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const phone = (body.phone ?? '').trim()
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    return NextResponse.json({ error: 'Please enter a valid phone number.' }, { status: 400 })
  }

  // Only record an opt-in when the user actually ticked the box.
  if (body.sms_consent === true) {
    const { error } = await supabaseAdmin.from('sms_consents').insert({
      phone:        toE164(phone),
      opt_in_text:  SMS_OPTIN_TEXT,
      source_url:   '/sms-opt-in',
      ip_address:   req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent:   req.headers.get('user-agent') ?? null,
      persona:      'public',
    })
    if (error) {
      return NextResponse.json({ error: `Could not record your opt-in: ${error.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, consented: body.sms_consent === true })
}
