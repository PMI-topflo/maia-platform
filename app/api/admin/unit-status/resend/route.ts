// =====================================================================
// POST /api/admin/unit-status/resend   { assoc, account }   (staff-only)
// Explicit single-unit resend from the detail modal's "Resend request"
// button — bypasses the automated audit's cadence/cap gate.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { sendOwnerComplianceLinkNow } from '@/lib/compliance-owner-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { assoc?: string; account?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!body.assoc || !body.account) return NextResponse.json({ error: 'assoc and account are required' }, { status: 400 })

  const result = await sendOwnerComplianceLinkNow(body.assoc, body.account)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
  return NextResponse.json({ ok: true, sentTo: result.sentTo })
}
