// =====================================================================
// lib/board-review-email.ts
//
// The three emails the board review sends:
//
//   1. to the board + on-site manager — "here are the documents, review them"
//   2. to PMI + Jonathan — one per RESPONSE, as it happens (user direction:
//      the office is not copied when the form goes out, it is told each time
//      somebody answers)
//   3. to whoever has not signed the approval letter — every 5 days, once the
//      30-day window is open
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { renderMaiaEmail } from '@/lib/maia-email'
import { getReviewState, boardWindowSentence, REVIEWER_ROLE_LABEL, type ReviewerRole } from '@/lib/board-review'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SUPPORT = 'support@topfloridaproperties.com'

/** The office. Everything the board answers lands here. */
export const OFFICE_EMAILS = (process.env.BOARD_REVIEW_OFFICE_EMAILS
  ?? 'PMI@topfloridaproperties.com,jonathan@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(e => e.includes('@'))

/** CC'd on every email MAIA sends TO the board — the review round, the
 *  signature reminder, and the initial signer invitation (decision-page/send)
 *  — so staff can watch what's actually going out and adjust the system if
 *  something looks wrong, now that these go out automatically. User
 *  direction, 2026-08-20. */
export const BOARD_EMAIL_CC = (process.env.BOARD_EMAIL_CC ?? 'PMI@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(e => e.includes('@'))

const TYPE_LABEL: Record<string, string> = {
  lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease Renewal', additional_occupant: 'Additional Occupant',
}
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const fmtET = (iso: string) => new Date(iso).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) + ' ET'

async function context(applicationId: string) {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label, application_type').eq('id', applicationId).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [{ data: assoc }, { data: people }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', applicationId).eq('role', 'applicant').order('is_primary', { ascending: false }),
  ])
  const unit = (app.unit_label as string | null) ?? null
  return {
    code, unit,
    legal: (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code,
    address: [assoc?.principal_address, unit ? `Unit ${unit}` : null,
      [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null,
    applicants: (people ?? []).map(p => String(p.name ?? '').trim()).filter(Boolean),
    typeLabel: TYPE_LABEL[String(app.application_type)] ?? String(app.application_type ?? ''),
  }
}

/** 1. Send the review out to the board + on-site manager. */
export async function sendReviewRound(roundId: string): Promise<{ sent: boolean; to: string[] }> {
  const { data: round } = await supabaseAdmin.from('document_review_rounds')
    .select('id, application_id, token, recipients, note').eq('id', roundId).maybeSingle()
  if (!round) return { sent: false, to: [] }
  const c = await context(String(round.application_id))
  const state = await getReviewState(String(round.application_id))
  if (!c || !state) return { sent: false, to: [] }

  const recipients = (Array.isArray(round.recipients) ? round.recipients : []) as { name?: string; email?: string; role?: string }[]
  const to = [...new Set(recipients.map(r => String(r.email ?? '').trim()).filter(e => e.includes('@')))]
  if (!to.length) return { sent: false, to: [] }

  // Everything that has ARRIVED is reviewable; what hasn't is listed separately
  // so nobody wonders why a required document has no buttons.
  const ready = state.rows.filter(r => r.state !== 'waiting')
  const waiting = state.rows.filter(r => r.state === 'waiting')

  const link = `${APP}/board-review/${round.token}`
  const html = renderMaiaEmail({
    associationName: c.legal, associationCode: c.code, propertyAddress: c.address,
    applicantNames: c.applicants, applicationType: c.typeLabel,
    heading: `Documents to review — ${c.unit ? `Unit ${c.unit}` : c.legal}`,
    intro: `${(round.note as string | null)?.trim() || `${c.applicants.join(' and ') || 'The applicant'} applied for a ${c.typeLabel.toLowerCase()}. Please review each document below and approve it, or refuse it with a short reason the applicant will read.`}\n\nAny one of you can settle a document — a board member or the on-site manager. ${boardWindowSentence(state.windowDays)}`,
    items: ready.map(r => ({
      label: r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label,
      whoFor: r.state === 'approved' ? 'Approved' : r.state === 'refused' ? 'Refused' : 'To review',
    })),
    onFile: waiting.map(r => ({
      label: r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label,
      note: 'not uploaded yet — nothing to review', expired: false,
    })),
    ctaUrl: link,
    footerReason: `You're receiving this as an approver for ${c.legal}.`,
  })

  await sendEmail({ to, cc: BOARD_EMAIL_CC, replyTo: SUPPORT, subject: `Documents to review — ${c.unit ? `Unit ${c.unit}` : c.legal} (${c.typeLabel})`, html })
  await supabaseAdmin.from('document_review_rounds').update({ updated_at: new Date().toISOString() }).eq('id', roundId)
  return { sent: true, to }
}

/** 2. One email to the office per response. */
export async function notifyOfficeOfReviewResponse(o: {
  applicationId: string; roundId: string; label: string
  decision: 'approved' | 'refused'; reason: string | null
  reviewerName: string; reviewerRole: ReviewerRole; windowOpened: boolean
}): Promise<void> {
  if (!OFFICE_EMAILS.length) return
  const c = await context(o.applicationId)
  const state = await getReviewState(o.applicationId)
  if (!c || !state) return

  const who = `${esc(o.reviewerName)} (${REVIEWER_ROLE_LABEL[o.reviewerRole]})`
  const verb = o.decision === 'approved' ? 'approved' : 'refused'
  const t = state.totals
  const progress = `${t.decided} of ${t.required} decided · ${t.waiting} still to arrive`

  await sendEmail({
    to: OFFICE_EMAILS, replyTo: SUPPORT,
    subject: `${o.reviewerName} ${verb} a document — ${c.unit ? `Unit ${c.unit}` : c.legal}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.55">
      <p><strong>${esc(o.label)}</strong> was <strong style="color:${o.decision === 'approved' ? '#0f7a4d' : '#b42318'}">${verb}</strong> by ${who}.</p>
      ${o.reason ? `<div style="border-left:3px solid #b42318;background:#fdf2f0;padding:10px 13px;margin:12px 0"><em>“${esc(o.reason)}”</em></div>` : ''}
      <p style="color:#6b7280">${esc(c.typeLabel)} · ${esc(c.address ?? c.legal)}<br>${esc(progress)}</p>
      ${o.windowOpened ? `<p style="background:#eef8f2;border:1px solid #cdeedd;border-radius:8px;padding:11px 13px;color:#166534"><strong>All documents are now approved.</strong> The ${state.windowDays}-day board window opened ${fmtET(state.windowOpenedAt ?? new Date().toISOString())}${state.dueAt ? ` — a decision is due ${fmtET(state.dueAt)}` : ''}.</p>` : ''}
      <p style="margin-top:18px"><a href="${APP}/admin/pre-apply/${o.applicationId}" style="color:#f26a1b;font-weight:600;text-decoration:none">Open the application →</a></p>
      <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p></div>`,
  })
}

/** 3. The 5-day nudge, once the window is open and the letter is unsigned. */
export async function sendSignatureReminder(roundId: string): Promise<{ sent: boolean; to: string[] }> {
  const { data: round } = await supabaseAdmin.from('document_review_rounds')
    .select('id, application_id, token, recipients, reminder_count').eq('id', roundId).maybeSingle()
  if (!round) return { sent: false, to: [] }
  const c = await context(String(round.application_id))
  const state = await getReviewState(String(round.application_id))
  if (!c || !state || !state.windowOpenedAt) return { sent: false, to: [] }

  // Only chase people who have NOT signed the approval letter yet.
  const { data: letter } = await supabaseAdmin.from('esign_documents')
    .select('signers').eq('kind', 'board_decision').eq('association_code', c.code).eq('unit_ref', c.unit ?? '')
    .neq('status', 'void').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const signed = new Set(((letter?.signers ?? []) as { email?: string; signed_at?: string | null }[])
    .filter(s => s.signed_at).map(s => String(s.email ?? '').toLowerCase()))

  const recipients = (Array.isArray(round.recipients) ? round.recipients : []) as { name?: string; email?: string }[]
  const to = [...new Set(recipients.map(r => String(r.email ?? '').trim()).filter(e => e.includes('@') && !signed.has(e.toLowerCase())))]
  if (!to.length) return { sent: false, to: [] }

  const due = state.dueAt ? fmtET(state.dueAt) : null
  const daysLeft = state.dueAt ? Math.ceil((new Date(state.dueAt).getTime() - Date.now()) / 86400000) : null

  await sendEmail({
    to, cc: BOARD_EMAIL_CC, replyTo: SUPPORT,
    subject: `Still needs your signature — ${c.unit ? `Unit ${c.unit}` : c.legal}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.55">
      <p>Every document for <strong>${esc(c.address ?? c.legal)}</strong> has been reviewed and approved. The approval letter is waiting for your signature.</p>
      ${due ? `<p style="background:${daysLeft !== null && daysLeft <= 7 ? '#fff8ec' : '#f9fafb'};border:1px solid ${daysLeft !== null && daysLeft <= 7 ? '#fde68a' : '#e5e7eb'};border-radius:8px;padding:11px 13px"><strong>A decision is due ${esc(due)}</strong>${daysLeft !== null ? ` — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}.</p>` : ''}
      <p style="margin:20px 0"><a href="${APP}/admin/pre-apply/${round.application_id}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Open the approval letter →</a></p>
      <p style="color:#9ca3af;font-size:12px">You're getting this because you haven't signed yet. Anyone who has already signed is not reminded.</p>
      <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p></div>`,
  })

  await supabaseAdmin.from('document_review_rounds')
    .update({ last_reminder_at: new Date().toISOString(), reminder_count: (Number(round.reminder_count) || 0) + 1 })
    .eq('id', roundId)
  return { sent: true, to }
}
