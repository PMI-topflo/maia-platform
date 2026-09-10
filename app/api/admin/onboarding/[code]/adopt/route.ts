// =====================================================================
// POST /api/admin/onboarding/[code]/adopt   (staff-only)
// Body: { meetingDate: 'YYYY-MM-DD', motionBy?: string, vote?: string }
//
// Stamps the adoption on the session and applies every unapplied decision
// to its live setting (lib/onboarding.ts → adoptSession). A per-item
// failure is recorded on that decision and reported back; the session
// only becomes 'adopted' when nothing failed.
// =====================================================================

import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { adoptSession } from '@/lib/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { code } = await ctx.params
  let body: { meetingDate?: string; motionBy?: string; vote?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  try {
    const result = await adoptSession(code, {
      meetingDate: String(body.meetingDate ?? ''),
      motionBy: String(body.motionBy ?? '').trim() || null,
      vote: String(body.vote ?? '').trim() || null,
      adoptedBy: staffLabel(session),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
