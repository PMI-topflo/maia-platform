// POST /api/admin/onboarding/[code]/extract   (staff-only)
// MAIA reads the association's filed documents and proposes the
// questionnaire's answers ("What they have today"). Replaces any pending
// proposals from an earlier run. Slow: scans are transcribed page by page.

import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { runExtraction } from '@/lib/onboarding-proposals'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { code } = await ctx.params
  try {
    const view = await runExtraction(code, staffLabel(session))
    return NextResponse.json(view)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
