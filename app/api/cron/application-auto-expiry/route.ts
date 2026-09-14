// GET /api/cron/application-auto-expiry
// Daily at 6 AM ET (Vercel fires 10:00 and 11:00 UTC; only the 6 AM ET run
// acts, DST-safe like the other daily crons) — one pass of
// lib/application-auto-expiry.ts: send expiry notices, expire what ran out,
// so the 7 AM "Applications to review" email can list both.
//   • Vercel cron (Bearer CRON_SECRET) — acts.
//   • Staff (session) — dry-run by default; ?send=1 acts; ?assoc=CODE narrows.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { runAutoExpiry } from '@/lib/application-auto-expiry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const RUN_HOUR_ET = 6
const easternHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()))

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const cron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  const staff = !!session && session.persona === 'staff'
  if (!cron && !staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (cron && !sp.get('force') && easternHour() !== RUN_HOUR_ET) return NextResponse.json({ skipped: true, reason: `not ${RUN_HOUR_ET} AM ET` })
  const dry = cron ? false : sp.get('send') !== '1'
  const result = await runAutoExpiry({ dry, associationCode: sp.get('assoc') ?? undefined })
  return NextResponse.json({ ok: true, dry, ...result })
}
