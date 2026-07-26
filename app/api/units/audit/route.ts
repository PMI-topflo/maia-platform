// =====================================================================
// GET /api/units/audit?assoc=CODE
// Association-scoped unit audit for the board / manager / staff portal.
// One row per unit: occupancy, owner, tenant, required-vs-on-file docs,
// and floor/line for the building grid. Financials (balance/collections)
// are fetched per-unit in the detail drawer, not here (avoids N CINC
// calls at grid load).
//
// Access: board | building_manager | unit_manager | staff. assoc is
// resolved from the session (board/managers are bound to one association)
// or from ?assoc= for staff. unit_manager is narrowed to managed_units.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildAssociationAudit } from '@/lib/association-audit'
import { listCurrentBalances } from '@/lib/integrations/cinc'
import { collectionsAccountsFor } from '@/lib/owner-ledger-flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['board', 'building_manager', 'unit_manager', 'staff'])

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || !ALLOWED.has(session.persona)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const paramAssoc = new URL(req.url).searchParams.get('assoc')?.toUpperCase() || null
  // Board/managers are bound to their own association; staff may pass ?assoc=.
  const assoc = session.persona === 'staff'
    ? (paramAssoc || session.associationCode || null)
    : (session.associationCode || null)
  if (!assoc) return NextResponse.json({ error: 'no association in scope' }, { status: 400 })

  // A board/manager may only view their OWN association.
  if (session.persona !== 'staff' && paramAssoc && paramAssoc !== assoc) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let units = await buildAssociationAudit(assoc)

  // A unit_manager only sees the units they manage.
  if (session.persona === 'unit_manager') {
    const { data: mgr } = await supabaseAdmin
      .from('unit_managers').select('managed_units').eq('id', session.userId).maybeSingle()
    const managed = new Set(((mgr?.managed_units as string[] | null) ?? []).map(String))
    if (managed.size) units = units.filter(u => managed.has(u.accountNumber) || managed.has(String(u.unit ?? '')))
  }

  const { data: assocRow } = await supabaseAdmin
    .from('associations').select('association_name').eq('association_code', assoc).maybeSingle()

  // Financials — two BULK CINC calls for the whole association (both cached),
  // not per-unit: current balance per homeowner + the collections-workflow
  // account set. The board's recurring "is this unit in collections?" comes
  // straight off the collections list.
  const [balances, collSet] = await Promise.all([
    listCurrentBalances(assoc).catch(() => new Map<string, number>()),
    collectionsAccountsFor(assoc).catch(() => new Set<string>()),
  ])
  const enriched = units.map(u => {
    const acct = u.accountNumber.toUpperCase()
    return { ...u, balance: balances.get(acct) ?? null, inCollections: collSet.has(acct) }
  })

  return NextResponse.json({
    associationCode: assoc,
    associationName: assocRow?.association_name ?? assoc,
    persona:         session.persona,
    units:           enriched,
  })
}
