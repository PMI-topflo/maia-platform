// =====================================================================
// GET /api/admin/cinc/owner-billing?assoc=ONE&account=ONE701
//
// Staff-only PROBE for the owner ACH-into-CINC feature. Reads a homeowner's
// CINC property record so we can confirm, before wiring any write:
//   • the PropertyID for an account (needed by the ACH write + SetAchDate)
//   • the BillingTypeID that means "Automatic ACH" (probe an owner who already
//     has it, e.g. ONE701) — that's the value the owner form will write.
// Read-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listAssociationProperties } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url     = new URL(req.url)
  const assoc   = (url.searchParams.get('assoc') ?? '').trim()
  const account = (url.searchParams.get('account') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  const props = await listAssociationProperties(assoc).catch(() => [])
  const match = account
    ? props.find(p => String(p.PropertyHOID ?? '').toUpperCase() === account)
    : undefined

  return NextResponse.json({
    ok: true,
    assoc, account,
    propertyCount: props.length,
    // The matched property (PropertyID + the address array carries BillingTypeID).
    matched: match ?? null,
    // First couple of raw rows so the field names are visible at a glance.
    sample: props.slice(0, 2),
  })
}
