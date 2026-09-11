// GET /api/cron/missing-docs-reminders
//
// Every 3 days, remind every stakeholder (applicant + owner + any agent on
// file) what's still missing on their application — not just whoever last
// emailed in. User direction, 2026-08-20 (Rule 2): "start sending the list
// of all missing files and info every 3 days to all stakeholders."
//
// No approval gate any more — user direction, 2026-09-11 ("remove the
// gate, send the first reminder automatically"): the one-time "Approve the
// missing-documents reminder?" email read as if staff owed a document
// review, and after the same-week push to cut staff emails it was noise.
//   • no prior application_reminder_approvals row → send now, log an
//     'approved' row (decided_by 'auto') so the 3-day cadence has a clock.
//   • newest row is 'pending' (drafted under the old gate, never decided)
//     → send now and close that row as auto-approved.
//   • newest row is 'approved' or 'declined' → send once 3 days have passed
//     since it, logging a new row. A decline only ever held one cycle.
// Stops entirely once nothing is missing (checked fresh every cycle). The
// daily Applications-to-review digest lists what was reminded (visibility
// in place of the gate).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOutstandingSummary } from '@/lib/application-outstanding-summary'
import { getReminderRecipients, sendMissingDocsReminder } from '@/lib/application-reminder'

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
  const newestByApp = new Map<string, { id: string; status: string; createdAt: number }>()
  for (const r of rows ?? []) {
    const appId = String(r.application_id)
    if (!newestByApp.has(appId)) newestByApp.set(appId, { id: String(r.id), status: String(r.status), createdAt: new Date(String(r.created_at)).getTime() })
  }

  const cutoff = Date.now() - REMINDER_DAYS * 86400000
  const drafted = 0
  let sent = 0, checked = 0
  const detail: { applicationId: string; action: 'sent'; to?: string[] }[] = []

  for (const appId of appIds) {
    const newest = newestByApp.get(appId)
    const pendingFromOldGate = newest?.status === 'pending'

    // Sent (or declined) within the last 3 days — wait for the cadence. A
    // 'pending' draft from the old gate is due now regardless of its age.
    if (newest && !pendingFromOldGate && newest.createdAt > cutoff) continue

    checked++
    const summary = await getOutstandingSummary(appId)
    if ('error' in summary || summary.nothingOutstanding) continue

    const recipients = await getReminderRecipients(appId)
    if (!recipients.length) continue

    const res = await sendMissingDocsReminder(appId, summary, recipients)
    const row = {
      status: 'approved',
      missing_summary: [...summary.rows.filter(r => !r.gatedBy).map(r => r.label), ...summary.declineQuestions],
      recipients: recipients.map(r => ({ name: r.name, email: r.email, role: r.role })),
      decided_by: newest ? 'auto (3-day cadence)' : 'auto (first reminder, no gate)', decided_at: new Date().toISOString(),
      sent_to: res.sent,
    }
    if (pendingFromOldGate && newest) {
      // Close the old gate's draft as the record of this send.
      await supabaseAdmin.from('application_reminder_approvals').update({ ...row, decided_by: 'auto (gate removed 2026-09-11)' }).eq('id', newest.id)
    } else {
      await supabaseAdmin.from('application_reminder_approvals').insert({ application_id: appId, ...row })
    }
    sent++
    detail.push({ applicationId: appId, action: 'sent', to: res.sent })
  }

  return NextResponse.json({ ok: true, checked, drafted, sent, detail })
}
