// POST /api/units/lease-packet/send  { account, assoc }
// Create a lease packet for a leased unit and email the owner AND the tenant
// their login-free e-signature links for the Landlord–Tenant Agreement.
// Triggered from the unit page (staff / board / manager). Snapshots the
// owner, tenant, lease term, and the association's legal name so the same
// flow serves any association.
//
// The actual create+send logic lives in lib/lease-packet.ts's
// sendLeasePacket() — shared with the applications request-docs flow, which
// used to wrongly ask for this document as an UPLOAD (see
// lib/application-esign-forms.ts) instead of triggering this same send.

import { NextResponse } from 'next/server'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { sendLeasePacket } from '@/lib/lease-packet'

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

  const result = await sendLeasePacket(auth.assoc, account, auth.persona)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error.startsWith('No owner') ? 400 : 500 })
  return NextResponse.json({ ok: true, packetId: result.packetId, sent: result.sent, skipped: result.skipped })
}
