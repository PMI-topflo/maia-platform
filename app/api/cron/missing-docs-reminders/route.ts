// GET /api/cron/missing-docs-reminders
//
// Every 3 days, remind every stakeholder (applicant + owner + any agent on
// file) what's still missing on their application — not just whoever last
// emailed in. User direction, 2026-08-20 (Rule 2): "start sending the list
// of all missing files and info every 3 days to all stakeholders."
//
// Gated behind a ONE-TIME approval from PMI + Jonathan per application:
//   • no prior application_reminder_approvals row → draft one, email the
//     office a link to approve, and stop (this cycle sends nothing further).
//   • newest row is 'approved' → send now, and log a new 'approved' row for
//     the audit trail — no re-asking, ever, for this application.
//   • newest row is 'pending' → already waiting on the office; don't nag by
//     drafting a second one.
//   • newest row is 'declined' → try again once another 3 days have passed.
// Stops entirely once nothing is missing (checked fresh every cycle).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOutstandingSummary } from '@/lib/application-outstanding-summary'
import { getReminderRecipients, sendMissingDocsReminder, draftReminderApproval } from '@/lib/application-reminder'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const REMINDER_DAYS = 3

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, status').in('status', ['submitted', 'under_review'])
  const appIds = (apps ?? []).map(a => String(a.id))
  if (!appIds.length) return NextResponse.json({ ok: true, checked: 0, drafted: 0, sent: 0 })

  const { data: rows } = await supabaseAdmin.from('application_reminder_approvals')
    .select('id, application_id, status, created_at').in('application_id', appIds).order('created_at', { ascending: false })
  const newestByApp = new Map<string, { status: string; createdAt: number }>()
  for (const r of rows ?? []) {
    const appId = String(r.application_id)
    if (!newestByApp.has(appId)) newestByApp.set(appId, { status: String(r.status), createdAt: new Date(String(r.created_at)).getTime() })
  }

  const cutoff = Date.now() - REMINDER_DAYS * 86400000
  let drafted = 0, sent = 0, checked = 0
  const detail: { applicationId: string; action: 'drafted' | 'sent' | 'skipped'; to?: string[] }[] = []

  for (const appId of appIds) {
    const newest = newestByApp.get(appId)

    // Already waiting on the office — don't draft a second one.
    if (newest?.status === 'pending') continue
    // Declined recently, or approved-but-not-due — wait for the cadence.
    if (newest && newest.createdAt > cutoff) continue

    checked++
    const summary = await getOutstandingSummary(appId)
    if ('error' in summary || summary.nothingOutstanding) continue

    const recipients = await getReminderRecipients(appId)
    if (!recipients.length) continue

    if (newest?.status === 'approved') {
      // Approved once, ever — every later cycle auto-sends, logging its own
      // row so the audit trail (and this same cutoff check) stays accurate.
      const res = await sendMissingDocsReminder(appId, summary, recipients)
      await supabaseAdmin.from('application_reminder_approvals').insert({
        application_id: appId, status: 'approved',
        missing_summary: [...summary.rows.filter(r => !r.gatedBy).map(r => r.label), ...summary.declineQuestions],
        recipients: recipients.map(r => ({ name: r.name, email: r.email, role: r.role })),
        decided_by: 'auto (previously approved)', decided_at: new Date().toISOString(),
        sent_to: res.sent,
      })
      sent++
      detail.push({ applicationId: appId, action: 'sent', to: res.sent })
    } else {
      // First cycle ever, or trying again after a decline — draft and wait.
      const token = await draftReminderApproval(appId, summary, recipients)
      if (token) { drafted++; detail.push({ applicationId: appId, action: 'drafted' }) }
    }
  }

  return NextResponse.json({ ok: true, checked, drafted, sent, detail })
}
