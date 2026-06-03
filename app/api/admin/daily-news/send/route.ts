// =====================================================================
// app/api/admin/daily-news/send/route.ts
//
// Staff-triggered "Send the Daily News right now" — same digest the cron
// sends, but authorized by the logged-in staff session instead of the
// CRON_SECRET, so a manager can fire it on demand from /admin/ideas.
//
//   POST            → build + send to the human staff in the digest
//   POST { dry:true } or GET → build + return recipients without sending
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { sendDailyNews } from '@/lib/staff-news'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

async function requireStaff() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

/** Preview (no send) — handy for the button to show "who will get it". */
export async function GET() {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await sendDailyNews({ appUrl: APP_URL, dry: true })
  return NextResponse.json(result)
}

export async function POST(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let dry = false
  try { const body = await req.json(); dry = body?.dry === true } catch { /* no body = real send */ }

  try {
    const result = await sendDailyNews({ appUrl: APP_URL, dry })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[admin/daily-news/send] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: `Send failed: ${(err as Error).message}` }, { status: 500 })
  }
}
