// GET  /api/reminder-approval/[token]  → the reminder cycle's public state,
//   for the approve/decline page.
// POST /api/reminder-approval/[token]  { action: 'approve' | 'decline' }
//   Approving sends the reminder to every stakeholder right now, and marks
//   this application's reminders "approved" going forward — the cron will
//   keep sending the same reminder every 3 days without asking again.
//   Declining leaves it as-is; the cron tries again after another 3 days.
// The id IS the credential — same model as every other token-gated page
// in this app (no login, no expiry column).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOutstandingSummary } from '@/lib/application-outstanding-summary'
import { getReminderRecipients, sendMissingDocsReminder, missingLines } from '@/lib/application-reminder'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const { data: row } = await supabaseAdmin.from('application_reminder_approvals')
    .select('id, application_id, status, missing_summary, recipients, decided_at, sent_to').eq('id', token).maybeSingle()
  if (!row) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', row.application_id).maybeSingle()

  // Live, not the frozen snapshot taken when this was first drafted — the
  // same computation Approve would actually send. Falls back to that
  // snapshot only if the live read fails (e.g. the application is gone),
  // so a broken link still shows something instead of an empty page.
  const live = await getOutstandingSummary(String(row.application_id))
  const missingSummary = !('error' in live) ? missingLines(live) : (row.missing_summary ?? [])

  return NextResponse.json({
    status: row.status,
    missingSummary,
    recipients: row.recipients ?? [],
    sentTo: row.sent_to ?? [],
    decidedAt: row.decided_at,
    associationCode: (app?.association_code as string | null) ?? null,
    unitLabel: (app?.unit_label as string | null) ?? null,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  let b: { action?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (b.action !== 'approve' && b.action !== 'decline') return NextResponse.json({ error: 'invalid action' }, { status: 400 })

  const { data: row } = await supabaseAdmin.from('application_reminder_approvals')
    .select('id, application_id, status').eq('id', token).maybeSingle()
  if (!row) return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
  if (row.status !== 'pending') return NextResponse.json({ error: `This was already ${row.status}.` }, { status: 409 })

  const status = b.action === 'approve' ? 'approved' : 'declined'
  const now = new Date().toISOString()
  await supabaseAdmin.from('application_reminder_approvals')
    .update({ status, decided_by: 'office', decided_at: now }).eq('id', token)

  let sentTo: string[] = []
  if (status === 'approved') {
    const applicationId = String(row.application_id)
    const [summary, recipients] = await Promise.all([getOutstandingSummary(applicationId), getReminderRecipients(applicationId)])
    if (!('error' in summary) && recipients.length) {
      const res = await sendMissingDocsReminder(applicationId, summary, recipients)
      sentTo = res.sent
      await supabaseAdmin.from('application_reminder_approvals').update({ sent_to: sentTo }).eq('id', token)
    }
  }

  return NextResponse.json({ ok: true, status, sentTo })
}
