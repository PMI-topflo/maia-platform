// POST /api/admin/pre-apply/[id]/withdraw   { reason, requestedBy }   (staff-only)
// Marks the application withdrawn, voids pending signatures, archives the
// Drive folder. Sends nothing — staff reply to the parties themselves.
import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { withdrawApplication } from '@/lib/application-withdraw'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let b: { reason?: unknown; requestedBy?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const r = await withdrawApplication(id, { reason: String(b.reason ?? ''), requestedBy: String(b.requestedBy ?? ''), by: staffLabel(session) })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
