// =====================================================================
// app/api/cron/daily-staff-news/route.ts
//
// Sends the "PMI Top Florida Daily News" digest — one branded HTML email
// to the whole team with a week-to-date section per staff member (plus a
// Team · Unassigned catch-all). Scheduled Mon–Fri ~5pm ET in vercel.json.
//
// Auth: Vercel cron Bearer token (CRON_SECRET), same as the other crons.
// Manual test: GET with `Authorization: Bearer $CRON_SECRET` (optionally
// `?dry=1` to build + return the digest without emailing).
// =====================================================================

import { NextResponse } from 'next/server'
import { sendDailyNews } from '@/lib/staff-news'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const dry = new URL(req.url).searchParams.get('dry') === '1'

  try {
    const result = await sendDailyNews({ appUrl: APP_URL, dry })
    return NextResponse.json({ ...result, recipientCount: result.recipients.length })
  } catch (err) {
    console.error('[daily-staff-news] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: `daily-staff-news failed: ${(err as Error).message}` }, { status: 500 })
  }
}
