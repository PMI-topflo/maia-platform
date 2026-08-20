// =====================================================================
// lib/application-reminder.ts
//
// The 3-day collective "what's still missing" reminder — sent to every
// stakeholder on the application (applicant + owner + any agent on file),
// not just whoever last emailed in. User direction, 2026-08-20 (Rule 2):
// "start sending the list of all missing files and info every 3 days to
// all stakeholders."
//
// Gated behind a ONE-TIME approval from PMI + Jonathan: the first cycle
// drafts and waits for a click (app/api/reminder-approval/[token]); every
// cycle after that auto-sends with no further approval needed ("approve
// once, then auto-send"). See app/api/cron/missing-docs-reminders for the
// cadence/gating logic that decides when to call these.
//
// Reuses getOutstandingSummary — the exact same "what's missing" computation
// lib/application-standard-reply.ts uses for its single-recipient draft —
// and the same token/email machinery every other collaborator link uses
// (signPreApplyToken, sendEmail).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { signPreApplyToken } from '@/lib/preapply-token'
import { OFFICE_EMAILS } from '@/lib/board-review-email'
import type { OutstandingSummary } from '@/lib/application-outstanding-summary'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export interface ReminderRecipient { stakeholderId: string; name: string | null; email: string; role: string }

/** Applicant + owner + any agent on file — every real person on the
 *  application, not just whoever's currently emailing in. */
export async function getReminderRecipients(applicationId: string): Promise<ReminderRecipient[]> {
  const { data } = await supabaseAdmin.from('application_stakeholders')
    .select('id, name, email, role').eq('application_id', applicationId)
    .in('role', ['applicant', 'owner', 'listing_agent', 'applicant_agent'])
  return (data ?? [])
    .filter(s => String(s.email ?? '').includes('@'))
    .map(s => ({ stakeholderId: String(s.id), name: (s.name as string | null) ?? null, email: String(s.email), role: String(s.role) }))
}

function missingLines(summary: OutstandingSummary): string[] {
  return [
    ...summary.rows.filter(r => !r.gatedBy).map(r => r.label),
    ...summary.declineQuestions.map(q => q === 'vehicle'
      ? 'Do you keep a vehicle at the unit? (yes/no)'
      : 'Do you have a pet, service animal, or emotional support animal in the unit? (yes/no)'),
  ]
}

async function associationName(code: string): Promise<string> {
  const { data } = await supabaseAdmin.from('associations').select('association_name, legal_name').eq('association_code', code).maybeSingle()
  return (data?.legal_name as string | null) || (data?.association_name as string | null) || code
}

/** Actually send the reminder — each recipient gets their own secure link.
 *  Best-effort per recipient; one failure doesn't block the others. */
export async function sendMissingDocsReminder(
  applicationId: string, summary: OutstandingSummary, recipients: ReminderRecipient[],
): Promise<{ sent: string[] }> {
  const assocName = await associationName(summary.associationCode)
  const lines = missingLines(summary)
  const sent: string[] = []
  for (const r of recipients) {
    try {
      const t = await signPreApplyToken(applicationId, r.stakeholderId)
      const link = `${APP}/pre-apply/${encodeURIComponent(summary.associationCode)}?t=${encodeURIComponent(t)}`
      await sendEmail({
        to: [r.email],
        subject: `Reminder: documents still needed — ${assocName}${summary.unitLabel ? ` Unit ${summary.unitLabel}` : ''}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
          <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
          <h2 style="margin:0 0 8px;color:#1f2a44">A few things are still needed</h2>
          <p>Hi${r.name ? ` ${esc(r.name)}` : ''}, the application for <strong>${esc(assocName)}</strong>${summary.unitLabel ? ` (Unit ${esc(summary.unitLabel)})` : ''} is still missing:</p>
          <ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
          <p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Open my part of the application →</a></p>
          <p style="color:#9ca3af;font-size:12px">You're receiving this because you're on file for this application. Already handled this? It may take a moment to update — questions, reply to this email.</p>
        </div>`,
      })
      sent.push(r.email)
    } catch { /* one failed send shouldn't block the rest */ }
  }
  return { sent }
}

/** First cycle only: draft the reminder and email PMI + Jonathan a link to
 *  approve it before anything goes to the actual stakeholders. Returns the
 *  approval row's id (the page/route token), or null if the insert failed. */
export async function draftReminderApproval(
  applicationId: string, summary: OutstandingSummary, recipients: ReminderRecipient[],
): Promise<string | null> {
  const missingSummary = missingLines(summary)
  const { data, error } = await supabaseAdmin.from('application_reminder_approvals').insert({
    application_id: applicationId, status: 'pending',
    missing_summary: missingSummary,
    recipients: recipients.map(r => ({ name: r.name, email: r.email, role: r.role })),
  }).select('id').single()
  if (error || !data) return null
  const token = String(data.id)

  const assocName = await associationName(summary.associationCode)
  const link = `${APP}/reminder-approval/${token}`
  await sendEmail({
    to: OFFICE_EMAILS,
    subject: `Approve reminder — ${assocName}${summary.unitLabel ? ` Unit ${summary.unitLabel}` : ''} still missing documents`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
      <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties · MAIA</p>
      <h2 style="margin:0 0 8px;color:#1f2a44">Approve the missing-documents reminder?</h2>
      <p><strong>${esc(assocName)}</strong>${summary.unitLabel ? `, Unit ${esc(summary.unitLabel)}` : ''} is still missing:</p>
      <ul>${missingSummary.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <p>Approving will email ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} on the application (applicant, owner, and any agent on file) right now. After that, MAIA sends this same reminder automatically every 3 days until nothing's missing — no further approval needed.</p>
      <p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#166534;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Review &amp; decide →</a></p>
    </div>`,
  }).catch(() => null)
  return token
}
