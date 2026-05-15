// =====================================================================
// GET /api/admin/cinc-sync/[code]/preview
// Returns the four-bucket diff (CINC vs MAIA) for one association.
// Staff sees this and picks which rows to apply.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { buildSyncPreview } from '@/lib/cinc-sync'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { code } = await ctx.params
  try {
    const preview = await buildSyncPreview(code)
    return NextResponse.json(preview)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
