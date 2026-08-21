// =====================================================================
// app/api/cron/daily-applications-review/route.ts
//
// Sends the "Applications to review" digest — every application whose
// documents are all on file but nobody has reviewed them yet (stage
// `not_sent`), grouped by association then unit, with a direct link.
// Target send time: 7:00 AM ET, every day — documents can arrive any day
// of the week, so this doesn't skip weekends the way Daily News does.
//
// DST-safe scheduling: same dual-UTC-hour trick as daily-staff-news —
// Vercel cron runs in UTC and doesn't follow DST, so this fires at both
// 11:00 and 12:00 UTC (vercel.json) and only actually sends when the
// current Eastern hour === 7 (11 UTC in EDT, 12 UTC in EST).
//
// Auth: Vercel cron Bearer token (CRON_SECRET). Manual test: GET with
// `Authorization: Bearer $CRON_SECRET` plus `?dry=1` (build only) and/or
// `?force=1` (bypass the 7 AM ET hour gate).
// =====================================================================

import { NextResponse } from 'next/server'
import { sendApplicationReviewDigest } from '@/lib/application-review-digest'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SEND_HOUR_ET = 7

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
  const dry   = params.get('dry') === '1'
  const force = params.get('force') === '1'

  const hour = easternHour()
  if (!dry && !force && hour !== SEND_HOUR_ET) {
    return NextResponse.json({ skipped: true, reason: `not 7 AM ET (current ET hour ${hour})` })
  }

  try {
    const result = await sendApplicationReviewDigest({ appUrl: APP_URL, dry })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[daily-applications-review] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: `daily-applications-review failed: ${(err as Error).message}` }, { status: 500 })
  }
}
