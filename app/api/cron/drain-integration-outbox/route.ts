// =====================================================================
// app/api/cron/drain-integration-outbox/route.ts
// Cron-triggered drain of pending CINC / Rentvine sync rows.
// Runs every minute via vercel.json. Auth via CRON_SECRET (matches
// the existing cron pattern in the repo).
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { drainBatch } from '@/lib/integrations/outbox-handler'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await drainBatch(50)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[drain-outbox] error:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
