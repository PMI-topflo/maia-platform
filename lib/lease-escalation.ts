// =====================================================================
// lib/lease-escalation.ts
//
// Phase 5 of the Checkr-first pipeline redesign (docs/ROADMAP.md): the
// lease non-renewal escalation — the first real consequence for an owner
// who never answers. Before this, app/api/cron/lease-renewal-alerts
// nagged at T-30 and T-7 and app/api/cron/expired-leases-digest nagged
// weekly forever, with nothing at the end of it.
//
// Timeline (user direction, 2026-09-15 — this REPLACES the T-30 start in
// the roadmap's original diagram: "after the end of the lease, they have
// 15 days to renew, then more 30 days to have the application expired if
// they don't present any document and the renewal is not active"):
//
//   T (lease end)         T+15                        T+45
//     escalation notice     the 15 days are up          no document and the
//     to the OWNER,         -> staff / board / on-site   renewal is not active
//     15-day clock starts      manager decide on a       -> the application
//                              violation fee             expires; the row goes
//                                                        red on the staff screen
//
// The clocks stop the moment the owner answers anything at all — the
// escalation is about an unresponsive owner, not about the lease itself
// (an owner who says "the unit is vacant" has answered, and is done).
//
// State lives on the existing lease_renewal_checks row (one per
// association+unit+lease end), so a resident who already answered the
// 30-day or 7-day reminder is never escalated. Those two crons and the
// weekly digest are what create the rows; this engine only ever reads
// rows that already exist, so a lease that ended with no row yet is
// picked up within a week, when the digest creates one.
//
// A lease that ended more than `backlogDays` ago is NOT escalated
// automatically. Measured against the live data 2026-09-15, 24 units would
// have been escalated on the first run, the oldest a lease that ended in
// April 2024 — those are stale tenant records, not owners ignoring us, and
// a fee threat is the wrong opening move. They are listed as backlog on the
// staff screen and escalate only when staff press the button.
//
// MAIA cannot post the violation fee itself — lib/integrations/cinc.ts
// reads homeowner ledgers and cannot write a charge. An authorized fee is
// recorded here and AR is emailed to post it in CINC (user direction,
// 2026-09-15).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { isSatisfied, hasOpenApplication, type LeaseRenewalCheck } from '@/lib/lease-renewal-check'
import { leaseEscalationOwnerHtml } from '@/lib/lease-renewal-email'
import { boardContactFor } from '@/lib/board-contact'
import { OFFICE_EMAILS } from '@/lib/board-review-email'
import { expireApplication } from '@/lib/application-withdraw'

/** Days the owner gets to renew after the lease ended, then the further
 *  days before the application itself expires. User direction 2026-09-15;
 *  change these two numbers to move both deadlines. */
export const ESCALATION = { renewDays: 15, expiryDays: 30, backlogDays: 90 } as const

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const D = 86_400_000

export type GraceOutcome = 'renewal_active' | 'expired_no_documents' | 'new_application_required'

export interface EscalationCheck extends LeaseRenewalCheck {
  escalated_at: string | null
  escalation_notice_sent_at: string | null
  escalation_resolved_at: string | null
  violation_fee_deadline: string | null
  violation_fee_notified_at: string | null
  violation_fee_authorized: boolean | null
  violation_fee_decided_at: string | null
  violation_fee_decided_by: string | null
  violation_fee_amount: number | null
  violation_fee_applied_at: string | null
  grace_deadline: string | null
  grace_outcome: GraceOutcome | null
  grace_outcome_at: string | null
}

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * D).toISOString().slice(0, 10)
/** Whole days from `iso` to today; negative while `iso` is still ahead. */
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso + 'T12:00:00Z').getTime()) / D)
const fmt = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const money = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** A check row whose unit_label is actually the CINC account number
 *  ("MANXI710") rather than the unit label ("710") — see the shadow-row note
 *  in buildEscalations. */
const isAccountKeyed = (c: { association_code: string; unit_label: string }) =>
  c.unit_label.toUpperCase().startsWith(c.association_code.toUpperCase()) && c.unit_label.length > c.association_code.length
const bareUnit = (c: { association_code: string; unit_label: string }) =>
  isAccountKeyed(c) ? c.unit_label.slice(c.association_code.length) : c.unit_label

async function assocNames(codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map()
  const { data } = await supabaseAdmin.from('associations').select('association_code, association_name').in('association_code', codes)
  return new Map((data ?? []).map(a => [String(a.association_code), String(a.association_name ?? a.association_code)]))
}

/** Everyone internal who needs to see an escalation: PMI + AR/Jonathan,
 *  the board (its shared mailbox when there is one, its members when there
 *  isn't) and the on-site managers. Nobody outside PMI/the association is
 *  ever on these — they are not applicant-facing. */
async function internalRecipients(code: string): Promise<string[]> {
  const c = await boardContactFor(code)
  return [...new Set([...OFFICE_EMAILS, ...(c.shared ? [c.shared] : c.members), ...c.managers].filter(e => e && e.includes('@')))]
}

/** Is there a renewal actually being worked for this unit? "Active" means a
 *  non-terminal application that has either been submitted or has at least
 *  one document on it — an empty shell nobody ever touched is not active,
 *  which is exactly the case the user asked to expire. */
async function renewalState(code: string, unit: string, applicationId: string | null): Promise<{ id: string | null; documents: number; active: boolean }> {
  let id = applicationId
  let submitted: string | null = null
  if (id) {
    const { data } = await supabaseAdmin.from('listing_applications').select('id, status, submitted_at').eq('id', id).maybeSingle()
    if (!data || ['approved', 'declined', 'withdrawn', 'expired'].includes(String(data.status))) id = null
    else submitted = (data.submitted_at as string | null) ?? null
  }
  if (!id) {
    const { data } = await supabaseAdmin.from('listing_applications').select('id, submitted_at')
      .eq('association_code', code).eq('unit_label', unit)
      .not('status', 'in', '("approved","declined","withdrawn","expired")')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data) { id = String(data.id); submitted = (data.submitted_at as string | null) ?? null }
  }
  if (!id) return { id: null, documents: 0, active: false }
  const { count } = await supabaseAdmin.from('application_documents').select('id', { count: 'exact', head: true }).eq('application_id', id)
  const documents = count ?? 0
  return { id, documents, active: documents > 0 || !!submitted }
}

// ── The engine ───────────────────────────────────────────────────────

export type EscalationAction =
  | 'escalated' | 'would_escalate'
  | 'fee_deadline_passed' | 'would_pass_fee_deadline'
  | 'grace_resolved' | 'would_resolve_grace'
  | 'resolved_by_owner' | 'skipped_no_owner_email' | 'skipped_open_application' | 'skipped_backlog'
  | 'skipped_vacated' | 'send_failed'

export interface EscalationRun { checkId: string; association: string; unit: string; action: EscalationAction; detail?: string; to?: string[] }

export async function runLeaseEscalations(opts: { dryRun: boolean }): Promise<EscalationRun[]> {
  const t = today()
  const { data: rows, error } = await supabaseAdmin.from('lease_renewal_checks').select('*')
    .lte('lease_end', t).is('grace_outcome', null).order('lease_end')
  // Never treat a missing column as "nothing to escalate" — an unapplied
  // migration would silently park every owner forever, which is the bug
  // the auto-expiry cron already had once (#929).
  if (error) throw new Error(`lease_renewal_checks escalation columns unavailable (apply 20260915_lease_renewal_escalation.sql): ${error.message}`)
  const checks = (rows ?? []) as EscalationCheck[]
  const names = await assocNames([...new Set(checks.map(c => c.association_code))])
  const out: EscalationRun[] = []

  for (const c of checks) {
    const assoc = names.get(c.association_code) ?? c.association_code
    const base = { checkId: c.id, association: assoc, unit: c.unit_label }
    const answered = isSatisfied(c).owner

    // The owner answered — the clocks stop wherever they are. No fee.
    if (answered) {
      if (c.escalated_at && !c.escalation_resolved_at) {
        out.push({ ...base, action: 'resolved_by_owner' })
        if (!opts.dryRun) await supabaseAdmin.from('lease_renewal_checks').update({ escalation_resolved_at: new Date().toISOString() }).eq('id', c.id)
      }
      continue
    }

    // ── T: the escalation notice ────────────────────────────────────
    if (!c.escalated_at) {
      // Staff is already working an application for this unit — nagging the
      // owner about a renewal that is underway is the noise the reminder
      // crons already learned to skip.
      if (await hasOpenApplication(c.association_code, c.unit_label)) { out.push({ ...base, action: 'skipped_open_application' }); continue }
      // The tenant already reported the unit empty. There is no occupancy to
      // be in violation, so the escalation copy would simply be wrong — the
      // weekly digest keeps asking the owner, without a fee clock.
      if (c.tenant_response === 'vacated' || c.tenant_response === 'vacating') { out.push({ ...base, action: 'skipped_vacated', detail: `Tenant reported ${c.tenant_response}.` }); continue }
      // Never start a fee clock against someone we could not tell.
      if (!c.owner_email) { out.push({ ...base, action: 'skipped_no_owner_email', detail: 'No owner email on the check-in row.' }); continue }
      // Long-dead leases are a data problem, not an unresponsive owner.
      if (daysSince(c.lease_end) > ESCALATION.backlogDays) { out.push({ ...base, action: 'skipped_backlog', detail: `Lease ended ${daysSince(c.lease_end)} days ago — staff decide on this one.` }); continue }

      const { deadline, grace } = escalationDeadlines(c.lease_end, t)
      if (opts.dryRun) { out.push({ ...base, action: 'would_escalate', to: [c.owner_email], detail: `Answer by ${deadline}; application expires ${grace}.` }); continue }
      const sent = await escalateOne(c, assoc)
      // A send that failed leaves no stamp and must not be reported as done —
      // the owner would be on a clock nobody told them about.
      out.push('error' in sent
        ? { ...base, action: 'send_failed', detail: sent.error }
        : { ...base, action: 'escalated', to: [c.owner_email], detail: `Answer by ${deadline}; application expires ${grace}.` })
      continue
    }

    // ── T+15: the 15 days are up, the fee decision is live ──────────
    if (c.violation_fee_deadline && c.violation_fee_deadline <= t && !c.violation_fee_notified_at) {
      const to = await internalRecipients(c.association_code)
      const authorized = c.violation_fee_authorized === true
      out.push({ ...base, action: opts.dryRun ? 'would_pass_fee_deadline' : 'fee_deadline_passed', to, detail: authorized ? 'Pre-authorized — AR asked to post the fee.' : 'Awaiting the yes/no on the violation fee.' })
      if (opts.dryRun) continue
      const now = new Date().toISOString()
      const html = feeDeadlineHtml({
        unit: c.unit_label, assoc, ownerName: c.owner_name, leaseEnd: c.lease_end,
        deadline: c.violation_fee_deadline, graceDeadline: c.grace_deadline,
        authorized, amount: c.violation_fee_amount, decidedBy: c.violation_fee_decided_by,
      })
      for (const addr of to) { try { await sendEmail({ to: addr, subject: `${authorized ? 'Violation fee due to be posted' : 'Violation fee decision needed'} — Unit ${c.unit_label}, ${assoc}`, html }) } catch { /* continue */ } }
      await supabaseAdmin.from('lease_renewal_checks').update({
        violation_fee_notified_at: now,
        ...(authorized ? { violation_fee_applied_at: now } : {}),
        updated_at: now,
      }).eq('id', c.id)
      // The grace clock keeps running; fall through to it on a later day.
      continue
    }

    // ── T+45: no document, no active renewal → the application expires ──
    if (c.grace_deadline && c.grace_deadline <= t) {
      const state = await renewalState(c.association_code, c.unit_label, c.application_id)
      const outcome: GraceOutcome = state.active ? 'renewal_active'
        : state.id ? 'expired_no_documents'
        : 'new_application_required'
      out.push({ ...base, action: opts.dryRun ? 'would_resolve_grace' : 'grace_resolved', detail: outcome })
      if (opts.dryRun) continue
      const now = new Date().toISOString()
      if (outcome === 'expired_no_documents' && state.id) {
        await expireApplication(state.id, {
          reason: `No document was ever presented and the renewal was not active ${ESCALATION.expiryDays} days after the ${ESCALATION.renewDays}-day renewal window closed (lease ended ${c.lease_end}).`,
          by: 'MAIA lease escalation',
        })
      }
      await supabaseAdmin.from('lease_renewal_checks').update({
        grace_outcome: outcome, grace_outcome_at: now,
        ...(outcome === 'renewal_active' ? { escalation_resolved_at: now } : {}),
        updated_at: now,
      }).eq('id', c.id)
      if (outcome !== 'renewal_active') {
        const to = await internalRecipients(c.association_code)
        const html = graceOutcomeHtml({ unit: c.unit_label, assoc, ownerName: c.owner_name, leaseEnd: c.lease_end, outcome })
        for (const addr of to) { try { await sendEmail({ to: addr, subject: `Unit ${c.unit_label}, ${assoc} — renewal window closed, a new lease application is now required`, html }) } catch { /* continue */ } }
      }
    }
  }
  return out
}

/** The two deadlines. The window runs from the lease end, but a row created
 *  late (the weekly digest backfilling a lease that ended months ago) would
 *  otherwise open and close on the same day — everyone gets a real
 *  `renewDays` from the day they are actually told. */
function escalationDeadlines(leaseEnd: string, from: string): { deadline: string; grace: string } {
  const deadline = [addDays(leaseEnd, ESCALATION.renewDays), addDays(from, ESCALATION.renewDays)].sort().pop()!
  return { deadline, grace: addDays(deadline, ESCALATION.expiryDays) }
}

/** Send the escalation notice and start both clocks. Shared by the cron and
 *  the staff "Escalate now" button on a backlog unit. */
export async function escalateOne(c: EscalationCheck, assoc: string): Promise<{ ok: true; deadline: string } | { error: string }> {
  if (!c.owner_email) return { error: 'No owner email on file for this unit — the clock cannot start against someone we cannot tell.' }
  if (c.escalated_at) return { error: 'This unit is already escalated.' }
  const { deadline, grace } = escalationDeadlines(c.lease_end, today())
  try {
    await sendEmail({
      to: c.owner_email,
      subject: `Action needed — Unit ${c.unit_label} has no approved lease on file (${assoc})`,
      html: leaseEscalationOwnerHtml({
        name: c.owner_name ?? '', unit: c.unit_label, assoc, end: c.lease_end,
        daysAgo: Math.max(0, daysSince(c.lease_end)),
        link: `${APP}/lease-renewal/${c.owner_token}`, deadline,
      }),
    })
  } catch (e) {
    // No stamp on a failed send — the cron retries tomorrow rather than
    // leaving an owner on a clock they were never told about.
    return { error: `The notice could not be sent: ${(e as Error).message}` }
  }
  const now = new Date().toISOString()
  await supabaseAdmin.from('lease_renewal_checks').update({
    escalated_at: now, escalation_notice_sent_at: now,
    violation_fee_deadline: deadline, grace_deadline: grace, updated_at: now,
  }).eq('id', c.id)
  return { ok: true, deadline }
}

/** Staff pressing "Escalate now" on a backlog unit — the same notice and the
 *  same clocks, just started by a person instead of by the date. */
export async function escalateById(id: string): Promise<{ ok: true; deadline: string } | { error: string }> {
  const { data, error } = await supabaseAdmin.from('lease_renewal_checks').select('*').eq('id', id).maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'escalation not found' }
  const c = data as EscalationCheck
  const names = await assocNames([c.association_code])
  return escalateOne(c, names.get(c.association_code) ?? c.association_code)
}

// ── Internal emails ──────────────────────────────────────────────────

const wrap = (title: string, body: string) => `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:560px;margin:0 auto">
  <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
  <h2 style="margin:0 0 8px;color:#1f2a44">${title}</h2>${body}
  <p style="color:#9ca3af;font-size:12px;margin-top:16px">Sent automatically by MAIA. The decision lives on Leasing &rarr; Lease escalations.</p></div>`

export function feeDeadlineHtml(o: { unit: string; assoc: string; ownerName: string | null; leaseEnd: string; deadline: string; graceDeadline: string | null; authorized: boolean; amount: number | null; decidedBy: string | null }): string {
  const who = o.ownerName ? esc(o.ownerName) : 'the owner'
  const facts = `<table style="border-collapse:collapse;font-size:13px;margin:6px 0 14px">
    <tr><td style="padding:3px 10px;color:#6b7280">Association</td><td style="padding:3px 10px">${esc(o.assoc)}</td></tr>
    <tr><td style="padding:3px 10px;color:#6b7280">Unit</td><td style="padding:3px 10px"><strong>${esc(o.unit)}</strong></td></tr>
    <tr><td style="padding:3px 10px;color:#6b7280">Owner</td><td style="padding:3px 10px">${who}</td></tr>
    <tr><td style="padding:3px 10px;color:#6b7280">Lease ended</td><td style="padding:3px 10px">${fmt(o.leaseEnd)}</td></tr>
    <tr><td style="padding:3px 10px;color:#6b7280">Answer was due</td><td style="padding:3px 10px"><strong>${fmt(o.deadline)}</strong></td></tr>
    ${o.graceDeadline ? `<tr><td style="padding:3px 10px;color:#6b7280">Application expires</td><td style="padding:3px 10px">${fmt(o.graceDeadline)}</td></tr>` : ''}
  </table>`
  if (o.authorized) {
    return wrap('Violation fee — please post it in CINC', `
      <p>The ${ESCALATION.renewDays}-day window closed with no answer from ${who}, and the fee was pre-authorized${o.decidedBy ? ` by ${esc(o.decidedBy)}` : ''}.</p>
      ${facts}
      <p><strong>AR: please post ${o.amount != null ? money(o.amount) : 'the violation fee'} to this owner's account in CINC.</strong> MAIA records the authorization but cannot post a charge to CINC itself.</p>
      <p style="color:#6b7280;font-size:12.5px">If the owner answers after this, the fee is not reversed automatically &mdash; reverse it in CINC.</p>`)
  }
  return wrap('Violation fee decision needed', `
    <p>${who} was told on the day the lease ended that a tenant occupying the unit without an approved lease is a violation, and was given ${ESCALATION.renewDays} days to answer. That window has now closed with no answer.</p>
    ${facts}
    <p><strong>Decision for staff and the Board:</strong> apply a violation fee to this owner's account, or not. Record it on <a href="${APP}/admin/lease-escalations">Leasing &rarr; Lease escalations</a>; an authorized fee is sent to AR to post in CINC.</p>`)
}

export function graceOutcomeHtml(o: { unit: string; assoc: string; ownerName: string | null; leaseEnd: string; outcome: GraceOutcome }): string {
  const who = o.ownerName ? esc(o.ownerName) : 'The owner'
  const expired = o.outcome === 'expired_no_documents'
  return wrap('Renewal window closed &mdash; a new lease application is now required', `
    <p><strong>Unit ${esc(o.unit)}, ${esc(o.assoc)}</strong> &mdash; the lease ended ${fmt(o.leaseEnd)}. ${who} did not answer within ${ESCALATION.renewDays} days, and ${ESCALATION.expiryDays} further days have now passed ${expired ? 'with no document ever presented and no active renewal' : 'with no renewal application ever opened'}.</p>
    ${expired ? '<p>The empty application has been expired (silently &mdash; its files moved to the unit&rsquo;s Archive, and staff can reopen it from Leasing &rarr; Housekeeping if this is wrong).</p>' : ''}
    <p>Anything filed for this unit from here is a <strong>new lease application</strong>: full document checklist, fresh background screening and the application fee &mdash; the ${ESCALATION.renewDays}+${ESCALATION.expiryDays}-day window is the association&rsquo;s own rule, already enforced by <code>lib/lease-renewal-rule.ts</code>.</p>`)
}

// ── Staff read model ─────────────────────────────────────────────────

export interface EscalationRow {
  id: string; association: string; associationName: string; unit: string
  ownerName: string | null; ownerEmail: string | null; tenantName: string | null
  leaseEnd: string; leaseEndedDaysAgo: number
  escalatedAt: string | null; resolvedAt: string | null
  feeDeadline: string | null; feeDaysLeft: number | null; feeNotifiedAt: string | null
  feeAuthorized: boolean | null; feeDecidedAt: string | null; feeDecidedBy: string | null
  feeAmount: number | null; feeAppliedAt: string | null
  graceDeadline: string | null; graceOutcome: GraceOutcome | null
  applicationId: string | null; documents: number
  status: string          // one plain-English line
  red: boolean            // blown window — same urgency as an expired document
}

/** A unit whose lease is long over and whose owner never answered, but which
 *  the cron deliberately does not escalate on its own — either it is older
 *  than `backlogDays` (a stale tenant record, not an unresponsive owner) or
 *  there is no owner email to tell. Staff decide these one at a time. */
export interface BacklogRow {
  id: string; association: string; associationName: string; unit: string
  ownerName: string | null; ownerEmail: string | null; tenantName: string | null
  leaseEnd: string; leaseEndedDaysAgo: number
  blocker: 'no_owner_email' | null   // null = escalatable, staff just have to say so
}

export interface Escalations { rows: EscalationRow[]; backlog: BacklogRow[] }

/** Every unit currently in the escalation, newest first, plus the backlog the
 *  cron will not touch by itself. Resolved rows are kept (staff need to see
 *  that an owner did answer) but never red. */
export async function buildEscalations(opts: { includeResolved?: boolean } = {}): Promise<Escalations> {
  const t = today()
  const backlogBefore = addDays(t, -ESCALATION.backlogDays)
  const [{ data, error }, { data: pending }] = await Promise.all([
    supabaseAdmin.from('lease_renewal_checks').select('*')
      .not('escalated_at', 'is', null).order('escalated_at', { ascending: false }).limit(500),
    supabaseAdmin.from('lease_renewal_checks').select('*')
      .is('escalated_at', null).lte('lease_end', backlogBefore).order('lease_end').limit(500),
  ])
  if (error) throw new Error(`lease_renewal_checks escalation columns unavailable (apply 20260915_lease_renewal_escalation.sql): ${error.message}`)
  const checks = (data ?? []) as EscalationCheck[]
  const waiting = (pending ?? []) as EscalationCheck[]
  const names = await assocNames([...new Set([...checks, ...waiting].map(c => c.association_code))])

  const rows: EscalationRow[] = []
  for (const c of checks) {
    const resolved = !!c.escalation_resolved_at
    if (resolved && !opts.includeResolved) continue
    const state = await renewalState(c.association_code, c.unit_label, c.application_id)
    const feeDaysLeft = c.violation_fee_deadline ? -daysSince(c.violation_fee_deadline) : null
    const graceBlown = !resolved && !!c.grace_deadline && c.grace_deadline <= t

    const status = resolved ? 'The owner answered — closed, no fee.'
      : c.grace_outcome === 'expired_no_documents' ? 'Window closed with nothing on file — the application was expired. A new lease application is required.'
      : c.grace_outcome === 'new_application_required' ? 'Window closed with no renewal ever opened. A new lease application is required.'
      : graceBlown ? 'The window has closed — resolving on the next run.'
      : c.violation_fee_applied_at ? 'Violation fee authorized and sent to AR to post in CINC.'
      : c.violation_fee_notified_at ? 'The 15 days are up with no answer — waiting on the violation-fee decision.'
      : c.violation_fee_authorized === false ? 'No fee (staff decision). Still waiting on the owner.'
      : c.violation_fee_authorized === true ? `Fee pre-authorized — charged if there is still no answer by ${c.violation_fee_deadline ? fmt(c.violation_fee_deadline) : 'the deadline'}.`
      : `Owner notified — ${feeDaysLeft != null && feeDaysLeft >= 0 ? `${feeDaysLeft} day${feeDaysLeft === 1 ? '' : 's'} left to answer` : 'waiting on an answer'}.`

    rows.push({
      id: c.id, association: c.association_code, associationName: names.get(c.association_code) ?? c.association_code, unit: c.unit_label,
      ownerName: c.owner_name, ownerEmail: c.owner_email, tenantName: c.tenant_name,
      leaseEnd: c.lease_end, leaseEndedDaysAgo: Math.max(0, daysSince(c.lease_end)),
      escalatedAt: c.escalated_at, resolvedAt: c.escalation_resolved_at,
      feeDeadline: c.violation_fee_deadline, feeDaysLeft, feeNotifiedAt: c.violation_fee_notified_at,
      feeAuthorized: c.violation_fee_authorized, feeDecidedAt: c.violation_fee_decided_at, feeDecidedBy: c.violation_fee_decided_by,
      feeAmount: c.violation_fee_amount != null ? Number(c.violation_fee_amount) : null, feeAppliedAt: c.violation_fee_applied_at,
      graceDeadline: c.grace_deadline, graceOutcome: c.grace_outcome,
      applicationId: state.id, documents: state.documents,
      status, red: graceBlown || c.grace_outcome === 'expired_no_documents' || c.grace_outcome === 'new_application_required',
    })
  }

  // Shadow rows. Both reminder crons key the check on `owner?.unitNumber ||
  // account`, so a run where findMergedOwner came back empty mints a SECOND
  // row for the same unit keyed on the account number ("MANXI710" beside
  // "710") with no owner name and no owner email. Measured 2026-09-15: 19 of
  // 60 rows are account-keyed, none has an owner email, and 14 of them
  // shadow a perfectly good row. They would read here as real "add an owner
  // email" work, so a shadow is dropped — but an account-keyed row with NO
  // twin is a unit whose owner never resolved at all, which IS real work and
  // stays. (The root cause is in findOrCreateCheck's callers, not here.)
  const twin = new Set([...checks, ...waiting].filter(c => !isAccountKeyed(c)).map(c => `${c.association_code}|${c.unit_label.toUpperCase()}|${c.lease_end}`))

  const backlog: BacklogRow[] = []
  for (const c of waiting) {
    if (isSatisfied(c).owner) continue
    if (isAccountKeyed(c) && twin.has(`${c.association_code}|${bareUnit(c).toUpperCase()}|${c.lease_end}`)) continue
    if (await hasOpenApplication(c.association_code, c.unit_label)) continue
    backlog.push({
      id: c.id, association: c.association_code, associationName: names.get(c.association_code) ?? c.association_code, unit: c.unit_label,
      ownerName: c.owner_name, ownerEmail: c.owner_email, tenantName: c.tenant_name,
      leaseEnd: c.lease_end, leaseEndedDaysAgo: Math.max(0, daysSince(c.lease_end)),
      blocker: c.owner_email ? null : 'no_owner_email',
    })
  }
  backlog.sort((a, b) => b.leaseEndedDaysAgo - a.leaseEndedDaysAgo)
  return { rows, backlog }
}

/** Staff's yes/no on pre-authorizing the violation fee. `authorized: null`
 *  puts the row back to undecided. */
export async function decideViolationFee(id: string, input: { authorized: boolean | null; amount: number | null; by: string }): Promise<{ ok: true } | { error: string }> {
  const { data } = await supabaseAdmin.from('lease_renewal_checks').select('*').eq('id', id).maybeSingle()
  if (!data) return { error: 'escalation not found' }
  const c = data as EscalationCheck
  if (!c.escalated_at) return { error: 'This unit has not been escalated yet.' }
  if (c.escalation_resolved_at) return { error: 'The owner already answered — there is no fee to decide.' }
  if (c.violation_fee_applied_at) return { error: 'The fee was already sent to AR to post in CINC. Reverse it there, not here.' }
  const now = new Date().toISOString()
  // Authorizing AFTER the deadline notice already went out: the cron's T+15
  // branch has run and will not run again, so AR is told from here instead —
  // otherwise the button would record a fee nobody was ever asked to post.
  const late = input.authorized === true && !!c.violation_fee_notified_at
  await supabaseAdmin.from('lease_renewal_checks').update({
    violation_fee_authorized: input.authorized,
    violation_fee_amount: input.authorized === true ? input.amount : null,
    violation_fee_decided_at: input.authorized === null ? null : now,
    violation_fee_decided_by: input.authorized === null ? null : input.by,
    ...(late ? { violation_fee_applied_at: now } : {}),
    updated_at: now,
  }).eq('id', id)

  if (late) {
    const names = await assocNames([c.association_code])
    const assoc = names.get(c.association_code) ?? c.association_code
    const html = feeDeadlineHtml({
      unit: c.unit_label, assoc, ownerName: c.owner_name, leaseEnd: c.lease_end,
      deadline: c.violation_fee_deadline ?? c.lease_end, graceDeadline: c.grace_deadline,
      authorized: true, amount: input.amount, decidedBy: input.by,
    })
    for (const addr of await internalRecipients(c.association_code)) {
      try { await sendEmail({ to: addr, subject: `Violation fee due to be posted — Unit ${c.unit_label}, ${assoc}`, html }) } catch { /* continue */ }
    }
  }
  return { ok: true }
}
