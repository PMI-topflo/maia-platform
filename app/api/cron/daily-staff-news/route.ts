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
import { sendEmail } from '@/lib/gmail'
import { fetchStaffList } from '@/lib/staff-list'
import { gatherStaffNews, buildStaffNewsEmail } from '@/lib/staff-news'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const dry = new URL(req.url).searchParams.get('dry') === '1'

  try {
    const data  = await gatherStaffNews()
    const email = buildStaffNewsEmail(data, APP_URL)

    // One newsletter to the whole team (transparency / motivation).
    const recipients = Array.from(new Set(
      (await fetchStaffList()).map(s => s.email).filter((e): e is string => !!e),
    ))

    if (dry) {
      return NextResponse.json({ ok: true, dry: true, recipients, subject: email.subject, totals: data.totals, sections: data.sections.length })
    }
    if (recipients.length === 0) {
      return NextResponse.json({ ok: false, reason: 'no active staff recipients' })
    }

    const res = await sendEmail({ to: recipients, subject: email.subject, html: email.html, text: email.text })
    return NextResponse.json({ ok: true, recipients: recipients.length, totals: data.totals, send: res })
  } catch (err) {
    console.error('[daily-staff-news] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: `daily-staff-news failed: ${(err as Error).message}` }, { status: 500 })
  }
}
