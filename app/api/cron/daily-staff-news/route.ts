// =====================================================================
// app/api/cron/daily-staff-news/route.ts
//
// Sends the "PMI Top Florida Daily News" digest — one branded HTML email
// to the whole team with a week-to-date section per staff member (plus a
// Team · Unassigned catch-all). Target send time: 5:00 AM ET, Mon–Fri.
//
// DST-safe scheduling: Vercel cron runs in UTC and does NOT follow DST, so
// the cron fires at BOTH 09:00 and 10:00 UTC (vercel.json) and this route
// only actually sends when the current Eastern hour === 5. That's 09 UTC in
// EDT (summer) and 10 UTC in EST (winter) — exactly one 5 AM ET send/day.
//
// Auth: Vercel cron Bearer token (CRON_SECRET). Manual test: GET with
// `Authorization: Bearer $CRON_SECRET` plus `?dry=1` (build only) and/or
// `?force=1` (bypass the 5 AM ET hour gate).
// =====================================================================

import { NextResponse } from 'next/server'
import { sendDailyNews } from '@/lib/staff-news'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const APP_URL  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SEND_HOUR_ET = 5   // 5:00 AM Eastern

function easternHour(): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).format(new Date()))
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const params = new URL(req.url).searchParams
  const dry    = params.get('dry') === '1'
  const force  = params.get('force') === '1'

  // Gate to 5 AM ET so the dual UTC cron (09:00 + 10:00) sends exactly once
  // regardless of daylight saving. Skipped for dry/force manual runs.
  const hour = easternHour()
  if (!dry && !force && hour !== SEND_HOUR_ET) {
    return NextResponse.json({ skipped: true, reason: `not 5 AM ET (current ET hour ${hour})` })
  }

  try {
    const result = await sendDailyNews({ appUrl: APP_URL, dry })
    return NextResponse.json({ ...result, recipientCount: result.recipients.length })
  } catch (err) {
    console.error('[daily-staff-news] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: `daily-staff-news failed: ${(err as Error).message}` }, { status: 500 })
  }
}
