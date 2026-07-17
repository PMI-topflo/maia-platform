// =====================================================================
// /api/cron/board-approval-reminders
// Nudges board members who haven't decided yet on an application,
// estimate, or invoice approval, per the association's configured
// reminder_cadence (board_approval_config). Stops once decided, once
// the parent item is finalized, or after 10 reminders. CRON_SECRET-guarded.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { VENDOR_REPLY_TO } from '@/lib/notify-recipients'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const DAY = 86_400_000
const MAX_REMINDERS = 10
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

const CADENCE_DAYS: Record<string, number> = {
  every_2_days: 2,
  every_3_days: 3,
  weekly: 7,
}

interface ReviewRow {
  id: string
  token: string
  board_member_name: string | null
  board_member_email: string | null
  decision: string | null
  sent_at: string
  last_reminder_sent_at: string | null
  reminder_count: number
}

async function remindOne(opts: {
  table: 'application_board_reviews' | 'estimate_approval_reviews' | 'invoice_approval_reviews'
  row: ReviewRow
  associationCode: string
  purpose: 'application' | 'invoice' | 'estimate'
  reviewLinkPath: string
  itemLabel: string
  now: number
  cadenceCache: Map<string, string>
}): Promise<boolean> {
  const { table, row, associationCode, purpose, reviewLinkPath, itemLabel, now, cadenceCache } = opts
  if (row.decision) return false
  if (!row.board_member_email) return false
  if (row.reminder_count >= MAX_REMINDERS) return false

  const cacheKey = `${associationCode}:${purpose}`
  const cached = cadenceCache.get(cacheKey)
  let cadence: string
  if (cached !== undefined) {
    cadence = cached
  } else {
    const { data: config } = await supabaseAdmin
      .from('board_approval_config')
      .select('reminder_cadence')
      .eq('association_code', associationCode)
      .eq('purpose', purpose)
      .maybeSingle()
    cadence = config?.reminder_cadence ?? 'off'
    cadenceCache.set(cacheKey, cadence)
  }
  if (cadence === 'off') return false

  const intervalDays: number | undefined = CADENCE_DAYS[cadence]
  if (!intervalDays) return false

  const since = now - new Date(row.last_reminder_sent_at ?? row.sent_at).getTime()
  if (since < intervalDays * DAY) return false

  const link = `${APP}${reviewLinkPath}?token=${row.token}`
  await sendEmail({
    to: row.board_member_email, replyTo: VENDOR_REPLY_TO,
    subject: `Reminder: board approval needed — ${itemLabel}`,
    html: `<p>Hi${row.board_member_name ? ` ${esc(row.board_member_name)}` : ''}, just following up — <strong>${esc(itemLabel)}</strong> is still waiting on your review.</p>
      <p><a href="${link}" style="background:#f26a1b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Review &amp; decide →</a></p>`,
  }).catch(() => null)

  await supabaseAdmin.from(table)
    .update({ last_reminder_sent_at: new Date(now).toISOString(), reminder_count: row.reminder_count + 1 })
    .eq('id', row.id)

  return true
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const now = Date.now()
  const cadenceCache = new Map<string, string>()
  let sent = 0

  // ── Applications ─────────────────────────────────────────────────
  {
    const { data: rows } = await supabaseAdmin
      .from('application_board_reviews')
      .select('id, token, board_member_name, board_member_email, decision, sent_at, last_reminder_sent_at, reminder_count, association_code, application_id, applications(board_decision)')
      .is('decision', null)
    for (const r of (rows ?? []) as unknown as (ReviewRow & { association_code: string; applications: { board_decision: string | null } | null })[]) {
      if (r.applications?.board_decision && r.applications.board_decision !== 'board_review') continue
      const ok = await remindOne({
        table: 'application_board_reviews', row: r, associationCode: r.association_code, purpose: 'application',
        reviewLinkPath: '/board/review', itemLabel: 'an association application', now, cadenceCache,
      })
      if (ok) sent++
    }
  }

  // ── Estimates ────────────────────────────────────────────────────
  {
    const { data: rows } = await supabaseAdmin
      .from('estimate_approval_reviews')
      .select('id, token, board_member_name, board_member_email, decision, sent_at, last_reminder_sent_at, reminder_count, approval_id, estimate_approvals(association_code, status)')
      .is('decision', null)
    for (const r of (rows ?? []) as unknown as (ReviewRow & { estimate_approvals: { association_code: string | null; status: string } | null })[]) {
      const approval = r.estimate_approvals
      if (!approval?.association_code || approval.status !== 'pending') continue
      const ok = await remindOne({
        table: 'estimate_approval_reviews', row: r, associationCode: approval.association_code, purpose: 'estimate',
        reviewLinkPath: '/board/estimate', itemLabel: 'a vendor estimate', now, cadenceCache,
      })
      if (ok) sent++
    }
  }

  // ── Invoices ─────────────────────────────────────────────────────
  {
    const { data: rows } = await supabaseAdmin
      .from('invoice_approval_reviews')
      .select('id, token, board_member_name, board_member_email, decision, sent_at, last_reminder_sent_at, reminder_count, approval_id, invoice_approvals(association_code, status, vendor_name)')
      .is('decision', null)
    for (const r of (rows ?? []) as unknown as (ReviewRow & { invoice_approvals: { association_code: string; status: string; vendor_name: string | null } | null })[]) {
      const approval = r.invoice_approvals
      if (!approval || approval.status !== 'pending') continue
      const ok = await remindOne({
        table: 'invoice_approval_reviews', row: r, associationCode: approval.association_code, purpose: 'invoice',
        reviewLinkPath: '/board/invoice-review', itemLabel: `an invoice from ${approval.vendor_name ?? 'a vendor'}`, now, cadenceCache,
      })
      if (ok) sent++
    }
  }

  return NextResponse.json({ ok: true, sent })
}
