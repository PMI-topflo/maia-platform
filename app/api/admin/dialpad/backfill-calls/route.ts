import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listAllCalls } from '@/lib/dialpad'
import { ingestCallEvent } from '@/lib/dialpad-ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let daysBack = 30
  try {
    const body = (await req.json().catch(() => ({}))) as { daysBack?: number }
    if (typeof body.daysBack === 'number' && body.daysBack > 0 && body.daysBack <= 365) {
      daysBack = Math.floor(body.daysBack)
    }
  } catch { /* default daysBack */ }

  const now           = Date.now()
  const startedAfter  = now - daysBack * 86_400 * 1000
  const startedBefore = now

  try {
    const calls = await listAllCalls({ startedAfter, startedBefore })

    let inserted = 0
    let skipped  = 0
    for (const call of calls) {
      if (call.entry_point_call_id != null) { skipped++; continue }
      const externalId = `dialpad_call_${call.call_id}`
      const { data: existing } = await supabaseAdmin
        .from('general_conversations')
        .select('id')
        .eq('external_id', externalId)
        .maybeSingle()
      if (existing) { skipped++; continue }
      await ingestCallEvent(call)
      inserted++
    }

    return NextResponse.json({
      ok:       true,
      found:    calls.length,
      inserted,
      skipped,
      daysBack,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
