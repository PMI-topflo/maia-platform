// GET /api/cron/board-review-reminders
//
// Every 5 days, remind whoever has NOT signed the approval letter — but only
// once the 30-day window is actually open, i.e. once every requested document
// has been received and approved. Chasing signatures for a letter that cannot
// be written yet is how reminders get ignored.
//
// Anyone who has already signed is never chased. Runs daily; each round is
// only picked up when its own 5 days are up.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { REVIEW_REMINDER_DAYS } from '@/lib/board-review'
import { sendSignatureReminder } from '@/lib/board-review-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only applications whose window is open. The column is null until the last
  // document lands, which is exactly the gate we want.
  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, status, board_window_opened_at')
    .not('board_window_opened_at', 'is', null)
    .in('status', ['submitted', 'under_review'])
  const openIds = (apps ?? []).map(a => String(a.id))
  if (!openIds.length) return NextResponse.json({ ok: true, checked: 0, sent: 0 })

  const { data: rounds } = await supabaseAdmin.from('document_review_rounds')
    .select('id, application_id, created_at, last_reminder_at')
    .in('application_id', openIds)

  const cutoff = Date.now() - REVIEW_REMINDER_DAYS * 86400000
  // One reminder per APPLICATION, from its newest round — several rounds on the
  // same unit must not turn into several emails on the same day.
  const newest = new Map<string, { id: string; last: number }>()
  for (const r of rounds ?? []) {
    const appId = String(r.application_id)
    const cur = newest.get(appId)
    const at = new Date(String(r.created_at)).getTime()
    if (!cur || at > cur.last) newest.set(appId, { id: String(r.id), last: at })
  }

  const due = (rounds ?? []).filter(r => {
    const pick = newest.get(String(r.application_id))
    if (!pick || pick.id !== String(r.id)) return false
    const since = r.last_reminder_at ? new Date(String(r.last_reminder_at)).getTime() : 0
    return since <= cutoff
  })

  let sent = 0
  const detail: { round: string; to: string[] }[] = []
  for (const r of due) {
    const res = await sendSignatureReminder(String(r.id)).catch(() => ({ sent: false, to: [] as string[] }))
    if (res.sent) { sent++; detail.push({ round: String(r.id), to: res.to }) }
  }

  return NextResponse.json({ ok: true, checked: due.length, sent, detail })
}
