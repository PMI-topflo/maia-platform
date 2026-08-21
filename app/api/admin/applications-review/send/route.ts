// =====================================================================
// app/api/admin/applications-review/send/route.ts
//
// Staff-triggered "Send the Applications-to-review digest right now" —
// same digest the cron sends, authorized by the logged-in staff session.
//
//   GET            → build + return recipients/counts without sending (preview)
//   POST { dry }   → build + send (or preview if dry:true)
// =====================================================================

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { sendApplicationReviewDigest } from '@/lib/application-review-digest'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function GET() {
  if (!(await requireStaffSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await sendApplicationReviewDigest({ appUrl: APP_URL, dry: true })
  return NextResponse.json(result)
}

export async function POST(req: Request) {
  if (!(await requireStaffSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let dry = false
  try { const body = await req.json(); dry = body?.dry === true } catch { /* no body = real send */ }

  try {
    const result = await sendApplicationReviewDigest({ appUrl: APP_URL, dry })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[admin/applications-review/send] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: `Send failed: ${(err as Error).message}` }, { status: 500 })
  }
}
