// GET /api/admin/pre-apply/occupant-lease-check?assoc=MANXI&unit=103&name=John+Doe
// Backs the staff "New application" form for additional_occupant: does the
// unit's current approved lease already name this occupant? If so, no fresh
// document is required to open the application; if not (or MAIA can't tell),
// the form falls back to requiring a Lease Addendum upload.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { checkOccupantInCurrentLease } from '@/lib/occupant-sponsorship'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const unit = (url.searchParams.get('unit') ?? '').trim()
  const name = (url.searchParams.get('name') ?? '').trim()
  if (!assoc || !unit || !name) return NextResponse.json({ error: 'assoc, unit, and name are required' }, { status: 400 })

  const result = await checkOccupantInCurrentLease(assoc, unit, name)
  return NextResponse.json(result)
}
