// =====================================================================
// GET /api/admin/unit-status   (staff-only)
// Portfolio-wide occupancy + lease-expiry + compliance-completeness view,
// one row per unit. Delegates the per-unit computation to the shared
// lib/association-audit.ts buildAssociationAudit() (unscoped = whole
// portfolio) — the same logic the board/manager unit-audit portal
// (/api/units/audit) uses scoped to one association.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { buildAssociationAudit } from '@/lib/association-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const audit = await buildAssociationAudit()
  const rows = audit.map(u => ({
    associationCode: u.associationCode,
    associationName: u.associationName,
    unit:            u.unit,
    accountNumber:   u.accountNumber,
    ownerName:       u.ownerName,
    occupancy:       u.occupancy,
    kind:            u.kind,
    tenantName:      u.tenantName,
    leaseEndDate:    u.leaseEndDate,
    missingCount:    u.missingCount,
  }))
  return NextResponse.json({ rows })
}
