// GET /api/cron/board-review-reminders
//
// Remind whoever has NOT signed the approval letter — two separate passes,
// because the OLD manual per-document round and the NEW automatic
// signature-reminder round (PR6) live in the same table but mean different
// things and run on different cadences:
//
//   • 'document_review' rounds — the staff escape hatch for a manual
//     re-review. Only applications still 'submitted'/'under_review' with an
//     open window. Every REVIEW_REMINDER_DAYS (5).
//   • 'signature_reminder' rounds — the automatic round PR6 opens the moment
//     the approval letter is sent. Only applications now 'approval_sent'.
//     Every SIGNATURE_REMINDER_DAYS (3), per user direction, 2026-08-20.
//
// Both call the same sendSignatureReminder (it doesn't care which purpose
// created the round — it just checks who hasn't signed the CURRENT letter),
// so the only real difference is which rounds/applications each pass reads.
// Anyone who has already signed is never chased. Runs daily; each round is
// only picked up when its own cadence is up.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { REVIEW_REMINDER_DAYS, SIGNATURE_REMINDER_DAYS } from '@/lib/board-review'
import { sendSignatureReminder } from '@/lib/board-review-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function runPass(purpose: 'document_review' | 'signature_reminder', statuses: string[], cadenceDays: number) {
  // Only applications whose window is open. The column is null until the last
  // document lands, which is exactly the gate we want.
  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, status, board_window_opened_at')
    .not('board_window_opened_at', 'is', null)
    .in('status', statuses)
  const openIds = (apps ?? []).map(a => String(a.id))
  if (!openIds.length) return { checked: 0, sent: 0, detail: [] as { round: string; to: string[] }[] }

  const { data: rounds } = await supabaseAdmin.from('document_review_rounds')
    .select('id, application_id, created_at, last_reminder_at')
    .eq('purpose', purpose)
    .in('application_id', openIds)

  const cutoff = Date.now() - cadenceDays * 86400000
  // One reminder per APPLICATION, from its newest round of this purpose —
  // several rounds on the same unit must not turn into several emails on the
  // same day.
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
  return { checked: due.length, sent, detail }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [manual, automatic] = await Promise.all([
    runPass('document_review', ['submitted', 'under_review'], REVIEW_REMINDER_DAYS),
    runPass('signature_reminder', ['approval_sent'], SIGNATURE_REMINDER_DAYS),
  ])

  return NextResponse.json({
    ok: true,
    checked: manual.checked + automatic.checked, sent: manual.sent + automatic.sent,
    manual, automatic,
  })
}
