// =====================================================================
// GET /api/admin/onboarding/[code]   → the questionnaire state (staff-only)
// =====================================================================

import { NextResponse } from 'next/server'
import { requireStaffSession, staffLabel } from '@/lib/staff-auth'
import { getOnboardingState } from '@/lib/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { code } = await ctx.params
  try {
    const state = await getOnboardingState(code, staffLabel(session))
    if (!state) return NextResponse.json({ error: `No association with code "${code.toUpperCase()}"` }, { status: 404 })
    return NextResponse.json(state)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
