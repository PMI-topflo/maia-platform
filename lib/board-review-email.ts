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
 *  direction, 2026-08-20 (PMI only); extended to include Jonathan 2026-09-06
 *  per explicit user request, matching OFFICE_EMAILS' own PMI+Jonathan pair
 *  above. */
export const BOARD_EMAIL_CC = (process.env.BOARD_EMAIL_CC ?? 'PMI@topfloridaproperties.com,jonathan@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(e => e.includes('@'))

/** The people who may decide: active board members + the association's on-site
 *  manager. Staff pick from these rather than typing addresses, so a decision
 *  is always attributable to a named approver. Shared by the manual "Send to
 *  the board to review" button (app/api/admin/pre-apply/[id]/board-review/
 *  route.ts) and ensureBoardReviewRoundSent below, so both pick the same
 *  people the same way. */
export async function approversFor(code: string): Promise<{ name: string; email: string; role: ReviewerRole }[]> {
  // Both tables store first_name/last_name, not a single name column.
  const [{ data: board }, { data: mgrs }] = await Promise.all([
    supabaseAdmin.from('board_members').select('first_name, last_name, email, position, active').eq('association_code', code),
    supabaseAdmin.from('building_managers').select('first_name, last_name, email, active').eq('association_code', code),
  ])
  const full = (a: unknown, b: unknown) => `${String(a ?? '').trim()} ${String(b ?? '').trim()}`.trim()
  const out: { name: string; email: string; role: ReviewerRole }[] = []
  for (const b of board ?? []) {
    if (b.active === false) continue
    const email = String(b.email ?? '').trim()
    const name = full(b.first_name, b.last_name)
    if (email.includes('@') && name) out.push({ name: b.position ? `${name} (${b.position})` : name, email, role: 'board' })
  }
  for (const m of mgrs ?? []) {
    if (m.active === false) continue
    const email = String(m.email ?? '').trim()
    const name = full(m.first_name, m.last_name)
    if (email.includes('@') && name) out.push({ name, email, role: 'onsite_manager' })
  }
  // Dedupe by address — one person wearing two hats gets one email.
  const seen = new Set<string>()
  return out.filter(p => !seen.has(p.email.toLowerCase()) && seen.add(p.email.toLowerCase()))
}

/** Real case, 2026-09-07 (4174 Inverrary Drive, Unit 912): the automatic
 *  decision letter fired and asked board members to SIGN a final approval
 *  without the board ever having been sent the per-document review round at
 *  all — staff had approved every document directly on the admin page, and
 *  nothing ever prompted anyone to press "Send to the board to review."
 *  advanceToApprovalSent (lib/board-decision-letter.ts) now calls this
 *  FIRST: if no document_review_round has ever gone out for this
 *  application, it sends one now (identical to the manual button) instead
 *  of the letter, and the letter waits for a later re-trigger once a real
 *  round exists. Returns true once a round already existed (or was just
 *  sent) so the letter can proceed. */
export async function ensureBoardReviewRoundSent(applicationId: string, code: string, unitLabel: string | null): Promise<boolean> {
  const { count } = await supabaseAdmin.from('document_review_rounds')
    .select('id', { count: 'exact', head: true }).eq('application_id', applicationId).eq('purpose', 'document_review')
  if ((count ?? 0) > 0) return true

  const approvers = await approversFor(code)
  if (!approvers.length) return false   // nothing to send to — leave the application waiting rather than sending a letter with no board involvement

  const { data: round, error } = await supabaseAdmin.from('document_review_rounds').insert({
    application_id: applicationId, association_code: code, unit_label: unitLabel,
    token: crypto.randomUUID(), recipients: approvers, started_by: 'auto', purpose: 'document_review',
  }).select('id').single()
  if (error || !round) return false

  await sendReviewRound(String(round.id))
  return false   // just sent now — the board hasn't had a chance to decide yet
}

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

/** Builds the exact subject + HTML the board round email sends — shared by
 *  the real send (below) and the staff preview send, so a preview is
 *  guaranteed to look like the real thing rather than a hand-approximated copy. */
async function buildReviewRoundEmail(applicationId: string, token: string, note: string | null): Promise<{ subject: string; html: string } | null> {
  const c = await context(applicationId)
  const state = await getReviewState(applicationId)
  if (!c || !state) return null

  // Everything that has ARRIVED is reviewable; what hasn't is listed separately
  // so nobody wonders why a required document has no buttons.
  const ready = state.rows.filter(r => r.state !== 'waiting')
  const waiting = state.rows.filter(r => r.state === 'waiting')

  const link = `${APP}/board-review/${token}`
  const html = renderMaiaEmail({
    associationName: c.legal, associationCode: c.code, unit: c.unit, propertyAddress: c.address,
    applicantNames: c.applicants, applicationType: c.typeLabel,
    heading: `Documents to review — ${c.unit ? `Unit ${c.unit}` : c.legal}`,
    intro: `${note?.trim() || `${c.applicants.join(' and ') || 'The applicant'} applied for a ${c.typeLabel.toLowerCase()}. Please review each document below and approve it, or refuse it with a short reason the applicant will read.`}\n\nAny one of you can settle a document — a board member or the on-site manager. ${boardWindowSentence(state.windowDays)}`,
    items: ready.map(r => ({
      label: r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label,
      // A document staff already pre-checked reads as a real board decision if
      // it just says "Approved" — the board hasn't weighed in on it yet. Real
      // case, 2026-08-22 (MANXI 303): every item was staff-approved before this
      // round ever went out, and the email told the board nothing was actually
      // theirs to do.
      whoFor: r.decision?.role === 'staff' ? 'AI Pre-Audited'
        : r.state === 'approved' ? 'Approved' : r.state === 'refused' ? 'Refused' : 'To review',
    })),
    onFile: waiting.map(r => ({
      label: r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label,
      note: 'not uploaded yet — nothing to review', expired: false,
    })),
    ctaUrl: link,
    ctaLabel: 'Check files and give the final approval →',
    footerReason: `You're receiving this as an approver for ${c.legal}.`,
  })

  return { subject: `Documents to review — ${c.unit ? `Unit ${c.unit}` : c.legal} (${c.typeLabel})`, html }
}

/** 1. Send the review out to the board + on-site manager. */
export async function sendReviewRound(roundId: string): Promise<{ sent: boolean; to: string[] }> {
  const { data: round } = await supabaseAdmin.from('document_review_rounds')
    .select('id, application_id, token, recipients, note').eq('id', roundId).maybeSingle()
  if (!round) return { sent: false, to: [] }

  const recipients = (Array.isArray(round.recipients) ? round.recipients : []) as { name?: string; email?: string; role?: string }[]
  const to = [...new Set(recipients.map(r => String(r.email ?? '').trim()).filter(e => e.includes('@')))]
  if (!to.length) return { sent: false, to: [] }

  const built = await buildReviewRoundEmail(String(round.application_id), String(round.token), (round.note as string | null) ?? null)
  if (!built) return { sent: false, to: [] }

  await sendEmail({ to, cc: BOARD_EMAIL_CC, replyTo: SUPPORT, subject: built.subject, html: built.html })
  await supabaseAdmin.from('document_review_rounds').update({ updated_at: new Date().toISOString() }).eq('id', roundId)
  return { sent: true, to }
}

/** Staff preview — sends the SAME email a real round would send, to ONE
 *  address only (the requesting staff member's own login email), never to
 *  the real board/on-site manager and never cc'd to the office (they're
 *  already the recipient). User direction, 2026-09-07: "I want also to see
 *  the email that the board receives for final approval... send one only
 *  for my email to view." Reuses the most recent real round's token if one
 *  exists so the CTA link actually opens the live review page; when no
 *  round has been started yet, the link is inert (nothing to review yet)
 *  and the banner below says so. */
export async function previewReviewRoundEmail(applicationId: string, toEmail: string): Promise<{ sent: boolean }> {
  const { data: latestRound } = await supabaseAdmin.from('document_review_rounds')
    .select('token, note').eq('application_id', applicationId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const token = (latestRound?.token as string | null) ?? 'preview'
  const note = (latestRound?.note as string | null) ?? null

  const built = await buildReviewRoundEmail(applicationId, token, note)
  if (!built) return { sent: false }

  const banner = `<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#3730a3">
    👁 <strong>Preview only</strong> — this is exactly what the board/on-site manager receive. Sent only to you${!latestRound ? '; the button below won’t open a live review yet since no round has been started.' : '.'}
  </div>`

  await sendEmail({ to: [toEmail], replyTo: SUPPORT, subject: `[Preview] ${built.subject}`, html: banner + built.html })
  return { sent: true }
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

/** The reviewer's OVERALL verdict on the whole application — not one
 *  document — via "Send Back" at the bottom of /board-review/[token]. User
 *  direction, 2026-08-22: "send back opens a text for them to fill and send
 *  me back an email with the items not approved and the text." Distinct
 *  from notifyOfficeOfReviewResponse, which fires per-document as decisions
 *  happen; this is the reviewer stepping back and saying "here's my overall
 *  concern" in their own words. */
export async function notifyOfficeOfSendBack(o: {
  applicationId: string; reviewerName: string; reviewerRole: ReviewerRole; note: string
}): Promise<void> {
  if (!OFFICE_EMAILS.length) return
  const c = await context(o.applicationId)
  const state = await getReviewState(o.applicationId)
  if (!c || !state) return

  const refused = state.rows.filter(r => r.state === 'refused')
  const who = `${esc(o.reviewerName)} (${REVIEWER_ROLE_LABEL[o.reviewerRole]})`

  await sendEmail({
    to: OFFICE_EMAILS, cc: BOARD_EMAIL_CC, replyTo: SUPPORT,
    subject: `Sent back by ${o.reviewerName} — ${c.unit ? `Unit ${c.unit}` : c.legal}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.55">
      <p><strong>${who}</strong> sent the application back instead of approving it.</p>
      <div style="border-left:3px solid #b42318;background:#fdf2f0;padding:10px 13px;margin:12px 0"><em>“${esc(o.note)}”</em></div>
      ${refused.length ? `<p style="color:#6b7280;margin-bottom:4px">Items not approved:</p>
        <ul style="margin:0 0 12px;padding-left:18px;color:#16202f">${refused.map(r => `<li>${esc(r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label)}${r.decision?.reason ? ` — <em>${esc(r.decision.reason)}</em>` : ''}</li>`).join('')}</ul>` : ''}
      <p style="color:#6b7280">${esc(c.typeLabel)} · ${esc(c.address ?? c.legal)}</p>
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
