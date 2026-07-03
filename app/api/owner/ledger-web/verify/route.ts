// =====================================================================
// POST /api/owner/ledger-web/verify
// Body: { assocCode, code }
//
// Second step — verifies the 6-digit code sent by /start, then emails the
// secure account-statement link (lib/owner-ledger-flow.ts deliverLedger).
// Re-checks collections status (defense in depth in case it changed
// between the two steps of the same request).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAccountInCollections, verifyLedgerOtp, deliverLedger, firstEmail, type OwnerUnit } from '@/lib/owner-ledger-flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? '')
  if (!session || session.persona !== 'owner' || session.userId == null) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  let body: { assocCode?: string; code?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const assocCode = String(body.assocCode ?? '').trim().toUpperCase()
  const code      = String(body.code ?? '').trim()
  if (!assocCode || (session.associationCode ?? '').toUpperCase() !== assocCode) {
    return NextResponse.json({ error: 'Association mismatch' }, { status: 403 })
  }
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const { data: ow } = await supabaseAdmin.from('owners')
    .select('account_number, association_name, unit_number, address, first_name, last_name, entity_name, emails')
    .eq('id', session.userId).maybeSingle()
  const account = ow?.account_number ? String(ow.account_number) : null
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  if (await isAccountInCollections(assocCode, account)) {
    return NextResponse.json({ error: 'collections' }, { status: 403 })
  }

  const email = firstEmail(ow?.emails)
  if (!email) return NextResponse.json({ error: 'no_email' }, { status: 400 })

  const valid = await verifyLedgerOtp(email, code)
  if (!valid) return NextResponse.json({ error: 'invalid_code' }, { status: 400 })

  const unit: OwnerUnit = {
    account, assoc: assocCode,
    associationName: String(ow?.association_name ?? '') || assocCode,
    unit: ow?.unit_number ? String(ow.unit_number) : null,
    address: ow?.address ? String(ow.address) : null,
    ownerName: String(ow?.entity_name ?? '') || `${ow?.first_name ?? ''} ${ow?.last_name ?? ''}`.trim() || 'Owner',
    email,
  }
  const res = await deliverLedger({ units: [unit], method: 'email', toPhone: '', toEmail: email })
  if (!res.ok) return NextResponse.json({ error: 'delivery_failed' }, { status: 502 })
  return NextResponse.json({ ok: true })
}
