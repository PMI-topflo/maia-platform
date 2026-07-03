// =====================================================================
// POST /api/admin/vendor-compliance/coi-exemption   (staff-only)
//
// Sets or clears a vendor's exemption from the invoice-push invalid-COI
// hard-block (app/api/admin/invoices/intake/[id]/push/route.ts) — e.g. an
// attorney or appraiser that legitimately never carries general liability.
// Writes lib/coi-verdict.ts's vendor_coi_exemptions table (the actual gate)
// and mirrors the value into CINC's own isRequired flag for visibility.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { setVendorCoiExemption } from '@/lib/coi-verdict'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function staffEmail(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return typeof session.userId === 'string' ? session.userId : 'staff'
}

export async function POST(req: Request) {
  const me = await staffEmail()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { vendorId?: number; vendorName?: string; exempt?: boolean; reason?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const vendorId = Number(body.vendorId)
  if (!Number.isFinite(vendorId)) return NextResponse.json({ error: 'vendorId required' }, { status: 400 })

  await setVendorCoiExemption(
    vendorId,
    body.vendorName ?? null,
    body.exempt === true,
    body.reason?.trim() || null,
    me,
  )
  return NextResponse.json({ ok: true })
}
