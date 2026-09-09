// =====================================================================
// GET /api/admin/unit-status/detail?assoc=X&account=Y   (staff-only)
// Full missing-item detail for one unit (account_number is the real unit
// key — see route.ts's comment on why unit_number alone isn't unique).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getUnitComplianceState, OCCUPANCY_LABEL } from '@/lib/unit-required-docs'
import { findMergedOwner } from '@/lib/owner-lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const assoc = searchParams.get('assoc')
  const account = searchParams.get('account')
  if (!assoc || !account) return NextResponse.json({ error: 'assoc and account are required' }, { status: 400 })

  const o = await findMergedOwner(assoc, account)

  const { occupancy, missing } = await getUnitComplianceState(assoc, account)

  return NextResponse.json({
    associationName: o?.associationName ?? assoc, unit: o?.unitNumber ?? null, ownerName: o?.name, ownerEmail: o?.firstEmail ?? null,
    occupancy, occupancyLabel: occupancy ? OCCUPANCY_LABEL[occupancy] : null, missing,
  })
}
