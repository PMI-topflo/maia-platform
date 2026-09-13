// POST /api/admin/payment-reconciliation/checkr-receipt { orderId, debited }   (staff-only)
import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { markReceiptDebited } from '@/lib/payment-reconciliation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: { orderId?: unknown; debited?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const orderId = String(b.orderId ?? '')
  if (!/^ord_[A-Za-z0-9_-]+$/.test(orderId)) return NextResponse.json({ error: 'orderId required' }, { status: 400 })
  try { await markReceiptDebited(orderId, b.debited === true, staffLabel(session)); return NextResponse.json({ ok: true }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
}
