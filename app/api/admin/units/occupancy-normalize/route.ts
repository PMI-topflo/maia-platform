// =====================================================================
// app/api/admin/units/occupancy-normalize/route.ts
//
// POST (staff) { assoc?: string } — repair unit_occupancy rows that were
// written under the bare unit label ("911") instead of the account number
// ("MANXI911"): the newer answer moves onto the account-keyed row and the
// label row is dropped. Every reader keys by account, so those rows were
// invisible (MANXI 911 / 702 / 514 / 401 owner answers, 2026-09-14).
// Safe to run again — it finds nothing the second time.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { normalizeUnitOccupancyRefs } from '@/lib/unit-required-docs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let assoc: string | undefined
  try { const b = await req.json(); if (typeof b?.assoc === 'string' && b.assoc.trim()) assoc = b.assoc.trim() } catch { /* no body = whole portfolio */ }
  const result = await normalizeUnitOccupancyRefs(assoc)
  return NextResponse.json({ ok: true, ...result })
}
