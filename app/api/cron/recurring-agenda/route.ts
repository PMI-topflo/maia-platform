// =====================================================================
// GET /api/cron/recurring-agenda  — Fridays
// Emails each active recurring service's vendor office a tokenized link
// to confirm next week's crew + day. Guarded by CRON_SECRET.
// vercel.json: { "path": "/api/cron/recurring-agenda", "schedule": "0 14 * * 5" }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { sendAgendaEmails } from '@/lib/recurring-agenda'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const r = await sendAgendaEmails()
  return NextResponse.json({ ok: true, ...r })
}
