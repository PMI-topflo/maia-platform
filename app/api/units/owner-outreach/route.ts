// POST /api/units/owner-outreach  { account, assoc }
// Emails the unit's owner their self-service link (/owner/compliance/<token>)
// so they can confirm occupancy (owner-occupied / leased / vacant), enter
// tenant info when leased, and upload documents. Board/manager/staff triggered
// from the unit page. Reuses the existing single-unit send.

import { NextResponse } from 'next/server'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { sendOwnerComplianceLinkNow } from '@/lib/compliance-owner-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { account?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = String(body.account ?? '').trim()
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const r = await sendOwnerComplianceLinkNow(auth.assoc, account)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, sentTo: r.sentTo })
}
