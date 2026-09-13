// GET /api/admin/payment-reconciliation?month=YYYY-MM   (staff-only)
import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { buildReconciliation } from '@/lib/payment-reconciliation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const month = new URL(req.url).searchParams.get('month') ?? new Date().toISOString().slice(0, 7)
  try { return NextResponse.json(await buildReconciliation(month)) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }) }
}
