// =====================================================================
// GET /api/cron/recurring-cycle-ended  — daily
// Emails the office once for each recurring service whose end date has
// passed (with details + a link to set it up again) and deactivates it.
// Guarded by CRON_SECRET.
// vercel.json: { "path": "/api/cron/recurring-cycle-ended", "schedule": "0 13 * * *" }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { notifyEndedRecurringCycles } from '@/lib/service-visits'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const r = await notifyEndedRecurringCycles()
  return NextResponse.json({ ok: true, ...r })
}
