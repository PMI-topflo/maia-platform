// GET  /api/admin/emergency-contacts/campaign?assoc=CODE → who WOULD be written to
// POST /api/admin/emergency-contacts/campaign { assoc, confirm? }
//
// The Emergency Contact List campaign: every owner at an association — rented
// out or not — and every renter.
//
// DRY RUN by default, exactly like the occupancy survey. This sends mail to
// every resident of an association, so the count and the list come back first
// and nothing leaves until `confirm: true` is passed. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { runEmergencyContactCampaign } from '@/lib/emergency-contact-campaign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = new URL(req.url).searchParams.get('assoc')
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  const result = await runEmergencyContactCampaign({ associationCode: assoc, createdBy: 'staff:preview' })
  return NextResponse.json(result)
}

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { assoc?: string; confirm?: boolean }
  try { body = await req.json() } catch { body = {} }
  if (!body.assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  const result = await runEmergencyContactCampaign({
    associationCode: body.assoc,
    confirm: !!body.confirm,
    createdBy: `staff:${session.displayName}`,
  })
  return NextResponse.json({ ok: true, ...result })
}
