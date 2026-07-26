// POST /api/units/occupancy  { account, status }
// Set a unit's occupancy (owner_occupied | leased | vacant). Board /
// managers / staff, scoped to their association. Upserts unit_occupancy
// (same shape staff writes), keyed on account_number (unit_ref).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import type { Occupancy } from '@/lib/unit-required-docs'

export const dynamic = 'force-dynamic'

const VALID = new Set<Occupancy>(['owner_occupied', 'leased', 'vacant'])

export async function POST(req: Request) {
  let body: { account?: string; status?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = String(body.account ?? '').trim()
  const status = String(body.status ?? '') as Occupancy
  if (!account || !VALID.has(status)) return NextResponse.json({ error: 'account + valid status required' }, { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { error } = await supabaseAdmin.from('unit_occupancy').upsert({
    association_code: auth.assoc,
    unit_ref:         account,
    status,
    updated_by:       `${auth.persona}:${auth.userId}`,
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'association_code,unit_ref' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, status })
}
