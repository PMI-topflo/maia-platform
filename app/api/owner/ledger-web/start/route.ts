// =====================================================================
// POST /api/owner/ledger-web/start
// Body: { assocCode }
//
// First step of the portal's "Get my account statement" button — the
// resident is already logged in (passkey/OTP session), but a SECOND,
// fresh factor is required before we hand out a financial document: emails
// a 6-digit code to the address on file (same mechanism the chat/voice
// ledger flow already uses — lib/owner-ledger-flow.ts sendLedgerOtp).
// Refuses (403) if the account is in collections — same gate voice/text
// already enforce.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAccountInCollections, sendLedgerOtp, firstEmail } from '@/lib/owner-ledger-flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? '')
  if (!session || session.persona !== 'owner' || session.userId == null) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  let body: { assocCode?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const assocCode = String(body.assocCode ?? '').trim().toUpperCase()
  if (!assocCode || (session.associationCode ?? '').toUpperCase() !== assocCode) {
    return NextResponse.json({ error: 'Association mismatch' }, { status: 403 })
  }

  const { data: ow } = await supabaseAdmin.from('owners')
    .select('account_number, emails')
    .eq('id', session.userId).maybeSingle()
  const account = ow?.account_number ? String(ow.account_number) : null
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  if (await isAccountInCollections(assocCode, account)) {
    return NextResponse.json({ error: 'collections' }, { status: 403 })
  }

  const email = firstEmail(ow?.emails)
  if (!email) return NextResponse.json({ error: 'no_email' }, { status: 400 })

  const otp = await sendLedgerOtp(email)
  if (!otp.ok) return NextResponse.json({ error: 'send_failed' }, { status: 502 })
  return NextResponse.json({ ok: true, masked: otp.masked })
}
