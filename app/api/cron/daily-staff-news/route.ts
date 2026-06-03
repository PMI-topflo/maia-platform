// =====================================================================
// app/api/cron/daily-staff-news/route.ts
//
// Sends the "PMI Top Florida Daily News" digest — one branded HTML email
// to the whole team with a week-to-date section per staff member (plus a
// Team · Unassigned catch-all).
//
// SCHEDULE: Mon–Fri 6:00 AM America/New_York. Vercel cron is UTC-only and
// does NOT follow DST, so vercel.json fires this at BOTH 10:00 and 11:00
// UTC (`0 10,11 * * 1-5`) and we gate here on the actual ET wall-clock
// hour: 10:00 UTC = 6am EDT (summer), 11:00 UTC = 6am EST (winter). Exactly
// one of the two matches 6am ET on any given weekday, so the email goes out
// once per weekday at 6am ET year-round. The off-hour invocation no-ops.
//
// Auth: Vercel cron Bearer token (CRON_SECRET), same as the other crons.
// Manual test: GET with `Authorization: Bearer $CRON_SECRET`. `?dry=1`
// builds without sending; `?force=1` bypasses the 6am-ET gate (so you can
// trigger a real send at any hour).
// =====================================================================

import { NextResponse } from 'next/server'
import { sendDailyNews } from '@/lib/staff-news'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SEND_HOUR_ET = 6

/** Current America/New_York hour (0–23) and weekday (0=Sun…6=Sat). */
function etNow(): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(new Date())
  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '0'
  const wdStr   = parts.find(p => p.type === 'weekday')?.value ?? 'Sun'
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { hour: Number(hourStr) % 24, weekday: wdMap[wdStr] ?? 0 }
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const params = new URL(req.url).searchParams
  const dry    = params.get('dry') === '1'
  const force  = params.get('force') === '1'

  // DST-proof 6am-ET gate: only the invocation that lands on 6am ET (and a
  // weekday) actually sends. Skips otherwise so the dual UTC schedule doesn't
  // double-send. `force` and `dry` bypass the gate for manual use.
  if (!force && !dry) {
    const { hour, weekday } = etNow()
    if (hour !== SEND_HOUR_ET || weekday < 1 || weekday > 5) {
      return NextResponse.json({ ok: true, skipped: true, reason: `not 6am ET on a weekday (ET hour=${hour}, weekday=${weekday})` })
    }
  }

  try {
    const result = await sendDailyNews({ appUrl: APP_URL, dry })
    return NextResponse.json({ ...result, recipientCount: result.recipients.length })
  } catch (err) {
    console.error('[daily-staff-news] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: `daily-staff-news failed: ${(err as Error).message}` }, { status: 500 })
  }
}
