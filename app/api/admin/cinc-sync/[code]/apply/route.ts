// =====================================================================
// POST /api/admin/cinc-sync/[code]/apply
// Applies the selected subset of the four-bucket diff. Body is the
// ApplySelection shape from lib/cinc-sync — owner cinc_property_ids,
// owner row ids, board cinc_board_member_ids, board row ids.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { applySync, type ApplySelection } from '@/lib/cinc-sync'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { code } = await ctx.params
  let body: Partial<ApplySelection>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const selection: ApplySelection = {
    ownerKeys:           Array.isArray(body.ownerKeys)           ? body.ownerKeys          .filter((s): s is string => typeof s === 'string') : [],
    insertBoardCincIds:  Array.isArray(body.insertBoardCincIds)  ? body.insertBoardCincIds .filter((n): n is number => typeof n === 'number') : [],
    deactivateBoardIds:  Array.isArray(body.deactivateBoardIds)  ? body.deactivateBoardIds .filter((s): s is string => typeof s === 'string') : [],
  }

  const actorEmail = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null
  try {
    const result = await applySync(code, selection, actorEmail)
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
