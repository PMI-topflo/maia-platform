// POST /api/admin/payment-reconciliation/payout { payoutId, received, note? }   (staff-only)
import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { markPayoutReceived } from '@/lib/payment-reconciliation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: { payoutId?: unknown; received?: unknown; note?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const payoutId = String(b.payoutId ?? '')
  if (!/^po_[A-Za-z0-9]+$/.test(payoutId)) return NextResponse.json({ error: 'payoutId required' }, { status: 400 })
  try {
    await markPayoutReceived(payoutId, b.received === true, staffLabel(session), typeof b.note === 'string' ? b.note : null)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
}
