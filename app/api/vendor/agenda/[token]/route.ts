// POST /api/vendor/agenda/[token]  { employeeIds: string[], plannedDate?: string }
// Vendor office confirms next week's agenda. Token-gated, public.
import { NextResponse } from 'next/server'
import { verifyAgendaToken } from '@/lib/agenda-token'
import { confirmAgenda } from '@/lib/recurring-agenda'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const serviceId = await verifyAgendaToken(token)
  if (!serviceId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: { employeeIds?: unknown; plannedDate?: unknown } = {}
  try { body = await req.json() } catch { /* */ }
  const employeeIds = Array.isArray(body.employeeIds) ? body.employeeIds.filter((x): x is string => typeof x === 'string') : []
  const plannedDate = typeof body.plannedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.plannedDate) ? body.plannedDate : null
  if (employeeIds.length === 0) return NextResponse.json({ error: 'select at least one crew member' }, { status: 400 })

  const r = await confirmAgenda({ serviceId, employeeIds, plannedDate })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, visitId: r.visitId, sent: r.sent })
}
