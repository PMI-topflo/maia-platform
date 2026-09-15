// =====================================================================
// lib/application-auto-expiry.ts
//
// Automatic expiry of dead applications — replaces manual housekeeping
// (user direction, 2026-09-14). Every day the cron looks at each open
// application still on the applicant's side and applies ONE rule:
//   no_files          opened, still no document after 7 days
//                     → email "upload within 7 days", expire on day 14
//   unpaid            screening fee required, unpaid 7 days after the start
//                     → email "48 hours to reactivate" with the pay link,
//                       expire after 48 h
//   stale             documents on file but nothing for 21 days
//                     → email "7 days to finish", expire on day 28
//   screening_expired paid + screened, the 45-day validity passed and no new
//                     document since → expires 7 days after the validity end
//                     (the re-screen payment email already went out at day 45)
// A notice is cleared the moment the person acts (a document arrives or the
// fee is paid). Expiry is the same silent close as Withdraw (files to the
// unit's Archive, reopen possible) and is listed in the daily staff email.
//
// LEASE RENEWALS get two more steps (user direction, 2026-09-15): 24 hours
// before the expiry the owner AND the tenant are warned that the renewal
// expires in 24 hours and that staying on without an approved renewal is
// a violation; when it expires, the owner is told the unit has no approved
// lease and is treated as becoming vacant, and the board, on-site manager
// and staff are told the tenant is expected to move out.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { signPreApplyToken } from '@/lib/preapply-token'
import { getIntakeChecklist, isApplicationType } from '@/lib/intake-documents'
import { getReviewStates } from '@/lib/board-review'
import { isScreeningExpired, screeningValidThrough } from '@/lib/screening/validity'
import { closeApplication } from '@/lib/application-withdraw'
import { getApplicationDashboard } from '@/lib/application-dashboard'
import { findMergedOwner } from '@/lib/owner-lookup'
import { boardContactFor } from '@/lib/board-contact'
import { OFFICE_EMAILS } from '@/lib/board-review-email'

export type NoticeKind = 'no_files' | 'unpaid' | 'stale' | 'screening_expired'
export const RULE = {
  noFilesAfterDays: 7, noFilesNoticeDays: 7,
  unpaidAfterDays: 7, unpaidNoticeHours: 48,
  staleAfterDays: 21, staleNoticeDays: 7,
  screeningGraceDays: 7,
} as const

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const H = 3_600_000, D = 86_400_000
const fmtET = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'

export interface AutoExpiryAction { applicationId: string; unit: string | null; association: string; applicants: string[]; kind: NoticeKind; action: 'noticed' | 'final_warning' | 'expired' | 'cleared' | 'would_notice' | 'would_final_warn' | 'would_expire'; dueAt?: string | null; to?: string[]; detail?: string }
const FINAL_WARNING_HOURS = 24
// The daily run is ~24 h apart: warn at the run before the one that would
// expire, and pin the expiry exactly 24 h after the warning.
const FINAL_WARNING_LOOKAHEAD_HOURS = 30

async function assocName(code: string): Promise<string> {
  const { data } = await supabaseAdmin.from('associations').select('legal_name, association_name').eq('association_code', code).maybeSingle()
  return String(data?.legal_name || data?.association_name || code)
}

async function feeRequired(code: string, type: string, provider: string | null): Promise<boolean> {
  if (!provider || !/checkr/i.test(provider)) return false
  if (!isApplicationType(type)) return false
  const list = await getIntakeChecklist(code, type).catch(() => [])
  return list.some(d => d.doc_key === 'background_credit' && d.required !== false)
}

function noticeHtml(o: { kind: NoticeKind; name: string | null; unit: string | null; assoc: string; dueAt: string; link: string; payLink: string | null }): { subject: string; html: string } {
  const where = `${o.assoc}${o.unit ? `, Unit ${o.unit}` : ''}`
  const hi = `Hi${o.name ? ` ${esc(o.name)}` : ''},`
  const btn = (href: string, label: string, primary = true) => `<p style="text-align:center;margin:20px 0"><a href="${href}" style="background:${primary ? '#f26a1b' : '#fff'};color:${primary ? '#fff' : '#1f2a44'};${primary ? '' : 'border:1px solid #d1d5db;'}text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">${label}</a></p>`
  const wrap = (title: string, body: string) => `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
    <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
    <h2 style="margin:0 0 8px;color:#1f2a44">${title}</h2>${body}
    <p style="color:#9ca3af;font-size:12px">Questions? Reply to this email or call (305) 900-5077. If you already handled this, it may take a moment to update.</p>
  </div>`
  if (o.kind === 'no_files') return {
    subject: `Your application at ${where} will expire on ${fmtET(o.dueAt).replace(/,? \d+:\d+ [AP]M ET$/, '')}`,
    html: wrap('Your application is still empty', `<p>${hi}</p><p>The application you opened for <strong>${esc(where)}</strong> has no documents yet. To keep it, upload your first document by <strong>${esc(fmtET(o.dueAt))}</strong>. After that it expires and you would start again.</p>${btn(o.link, 'Open my application →')}`),
  }
  if (o.kind === 'unpaid') return {
    subject: `48 hours to reactivate your application — ${where}`,
    html: wrap('Your application is waiting on the background-check fee', `<p>${hi}</p><p>Your application for <strong>${esc(where)}</strong> cannot move forward until the background-check fee is paid. Pay by <strong>${esc(fmtET(o.dueAt))}</strong> to keep it active; after that it expires.</p>${o.payLink ? btn(o.payLink, 'Confirm & pay →') : ''}${btn(o.link, 'See my application →', false)}`),
  }
  if (o.kind === 'stale') return {
    subject: `7 days to finish your application — ${where}`,
    html: wrap('Your application has been waiting for a while', `<p>${hi}</p><p>Nothing has arrived on your application for <strong>${esc(where)}</strong> in three weeks. Send what is still missing by <strong>${esc(fmtET(o.dueAt))}</strong>; after that it expires and, if a background check was paid, it would have to be paid again.</p>${btn(o.link, 'Finish my application →')}`),
  }
  return { subject: `Your application at ${where} has expired`, html: wrap('Application expired', `<p>${hi}</p><p>The 45-day validity of your background check ended without the remaining documents, so the application for <strong>${esc(where)}</strong> has expired. To apply again, use the payment link we emailed you when the check expired, or reply to this email.</p>`) }
}

/** Owner emails for a renewal: the owner stakeholder(s) on the application,
 *  else every co-owner on file for the unit (owners table by account). */
async function ownerEmailsFor(applicationId: string, code: string, unit: string | null): Promise<{ name: string | null; emails: string[] }> {
  const { data } = await supabaseAdmin.from('application_stakeholders').select('name, email').eq('application_id', applicationId).eq('role', 'owner')
  const fromApp = (data ?? []).filter(s => String(s.email ?? '').includes('@'))
  if (fromApp.length) return { name: fromApp.map(s => String(s.name ?? '')).filter(Boolean).join(' & ') || null, emails: [...new Set(fromApp.map(s => String(s.email).toLowerCase()))] }
  const o = unit ? await findMergedOwner(code, `${code}${unit.replace(/\D/g, '')}`).catch(() => null) : null
  return { name: o?.name ?? null, emails: (o?.allEmails ?? []).map(e => e.toLowerCase()) }
}

function renewalFinalWarningHtml(o: { to: 'owner' | 'tenant'; name: string | null; tenants: string; unit: string | null; assoc: string; expiresAt: string; link: string | null }): { subject: string; html: string } {
  const where = `${o.assoc}${o.unit ? `, Unit ${o.unit}` : ''}`
  const body = o.to === 'tenant'
    ? `<p>Hi${o.name ? ` ${esc(o.name)}` : ''},</p><p>Your lease renewal application for <strong>${esc(where)}</strong> is still incomplete and <strong>expires in 24 hours, on ${esc(fmtET(o.expiresAt))}</strong>.</p><p>Once it expires there is no approved lease renewal on file for the unit. <strong>Staying in the unit without an approved renewal constitutes a violation of the association's rules</strong>, for you and for the unit owner. To avoid that, send the missing items before the deadline.</p>${o.link ? `<p style="text-align:center;margin:20px 0"><a href="${o.link}" style="background:#f26a1b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Finish my renewal now →</a></p>` : ''}`
    : `<p>Hi${o.name ? ` ${esc(o.name)}` : ''},</p><p>The lease renewal application for your tenant${o.tenants ? ` <strong>${esc(o.tenants)}</strong>` : ''} at <strong>${esc(where)}</strong> is still incomplete and <strong>expires in 24 hours, on ${esc(fmtET(o.expiresAt))}</strong>.</p><p>Once it expires there is no approved lease renewal on file. <strong>A tenant staying in the unit without an approved renewal constitutes a violation of the association's rules</strong>, and the owner is responsible. Please make sure the missing items are sent before the deadline, or tell us the tenant is moving out.</p>`
  return { subject: `24 hours left — lease renewal at ${where} expires ${fmtET(o.expiresAt)}`, html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
    <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
    <h2 style="margin:0 0 8px;color:#1f2a44">Final notice: lease renewal expires in 24 hours</h2>${body}
    <p style="color:#9ca3af;font-size:12px">Questions? Reply to this email or call (305) 900-5077.</p></div>` }
}

/** After a renewal expires: the owner hears the unit has no approved lease
 *  and is treated as becoming vacant; the board, on-site manager and staff
 *  hear the tenant is expected to move out. Best-effort, never throws. */
async function notifyRenewalExpired(o: { applicationId: string; code: string; unit: string | null; assoc: string; tenants: string; expiredAt: string }): Promise<string[]> {
  const sent: string[] = []
  const where = `${o.assoc}${o.unit ? `, Unit ${o.unit}` : ''}`
  const owner = await ownerEmailsFor(o.applicationId, o.code, o.unit)
  const wrap = (title: string, body: string) => `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
    <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
    <h2 style="margin:0 0 8px;color:#1f2a44">${title}</h2>${body}
    <p style="color:#9ca3af;font-size:12px">Questions? Reply to this email or call (305) 900-5077.</p></div>`
  for (const to of owner.emails) {
    try {
      await sendEmail({ to: [to], subject: `Lease renewal expired — ${where}: no approved lease on file`, html: wrap('Lease renewal expired', `<p>Hi${owner.name ? ` ${esc(owner.name)}` : ''},</p><p>The lease renewal application for your tenant${o.tenants ? ` <strong>${esc(o.tenants)}</strong>` : ''} at <strong>${esc(where)}</strong> expired on <strong>${esc(fmtET(o.expiredAt))}</strong> without the required items.</p><p>There is now <strong>no approved lease on file</strong> for the unit, and the association will treat it as becoming vacant. If the tenant is moving out, please confirm the move-out date. If the tenant is staying, that is a violation of the association's rules until a new lease application is submitted and approved — reply to this email and we will open one.</p>`) })
      sent.push(to)
    } catch { /* continue */ }
  }
  const board = await boardContactFor(o.code).catch(() => ({ shared: null, members: [] as string[], managers: [] as string[] }))
  const staffAndBoard = [...new Set([...OFFICE_EMAILS, ...board.members, ...board.managers, ...(board.shared ? [board.shared] : [])].map(e => e.toLowerCase()))].filter(e => !owner.emails.includes(e))
  for (const to of staffAndBoard) {
    try {
      await sendEmail({ to: [to], subject: `Unit ${o.unit ?? '—'} — lease renewal expired, tenant expected to move out (${o.assoc})`, html: wrap('Lease renewal expired — tenant expected to move out', `<p><strong>Unit ${esc(o.unit ?? '—')}, ${esc(o.assoc)}</strong>: the lease renewal application for <strong>${esc(o.tenants || 'the tenant')}</strong> expired on ${esc(fmtET(o.expiredAt))} without the required items.</p><p>There is no approved lease on file. The owner${owner.name ? ` (${esc(owner.name)})` : ''} has been told the unit is treated as becoming vacant and that a tenant staying on is a violation. Expect a move-out, or a new lease application.</p><p style="color:#6b7280;font-size:12px">Sent automatically by MAIA. Staff can reopen the application from Leasing → Housekeeping if this was a mistake.</p>`) })
      sent.push(to)
    } catch { /* continue */ }
  }
  return sent
}

async function recipientsFor(applicationId: string, type: string): Promise<{ stakeholderId: string; name: string | null; email: string; role: string }[]> {
  const roles = type === 'lease_renewal' ? ['applicant', 'owner'] : ['applicant']
  const { data } = await supabaseAdmin.from('application_stakeholders').select('id, name, email, role').eq('application_id', applicationId).in('role', roles)
  return (data ?? []).filter(s => String(s.email ?? '').includes('@')).map(s => ({ stakeholderId: String(s.id), name: (s.name as string | null) ?? null, email: String(s.email).toLowerCase(), role: String(s.role) }))
}

/** One pass over every open application. `dry` computes and reports
 *  without emailing or closing anything. */
export async function runAutoExpiry(opts: { dry?: boolean; associationCode?: string } = {}): Promise<{ checked: number; actions: AutoExpiryAction[] }> {
  const now = Date.now(), nowIso = new Date(now).toISOString()
  let q = supabaseAdmin.from('listing_applications')
    .select('id, association_code, unit_label, application_type, status, created_at, updated_at, screening_provider, detailed_application_id')
    .in('status', ['started', 'submitted'])
  if (opts.associationCode) q = q.eq('association_code', opts.associationCode.toUpperCase())
  const { data: baseApps } = await q
  // The notice columns arrive with a migration; read them separately so a
  // dry run before it is applied still works (no notices = none open).
  type Notice = { expiry_notice_kind: string | null; expiry_notice_at: string | null; expiry_due_at: string | null; expiry_final_warned_at: string | null }
  const empty: Notice = { expiry_notice_kind: null, expiry_notice_at: null, expiry_due_at: null, expiry_final_warned_at: null }
  const notices = await supabaseAdmin.from('listing_applications').select('id, expiry_notice_kind, expiry_notice_at, expiry_due_at, expiry_final_warned_at').in('status', ['started', 'submitted'])
    .then(r => new Map((r.data ?? []).map(n => [String(n.id), n as unknown as Notice & { id: string }])), () => new Map<string, Notice & { id: string }>())
  const apps = (baseApps ?? []).map(a => ({ ...a, ...(notices.get(String(a.id)) ?? empty) }))
  const dash = await getApplicationDashboard({ includeDecided: false }).catch(() => null)
  const stageById = new Map((dash?.rows ?? []).map(r => [r.id, r.stage]))
  const states = await getReviewStates((apps ?? []).map(a => String(a.id))).catch(() => new Map())
  const actions: AutoExpiryAction[] = []
  const names = new Map<string, string>()

  for (const a of apps ?? []) {
    const id = String(a.id), code = String(a.association_code), unit = (a.unit_label as string | null) ?? null, type = String(a.application_type ?? '')
    const stage = stageById.get(id) ?? 'applicant'
    // Only while the ball is on the applicant's side. Anything under
    // review, at the board, in interview or awaiting signatures is
    // PMI's / the board's, never expired by the clock.
    if (!['applicant', 'refused', 'not_sent'].includes(stage)) continue
    const [{ data: docs }, { data: stk }, { data: pay }] = await Promise.all([
      supabaseAdmin.from('application_documents').select('created_at').eq('application_id', id).order('created_at', { ascending: false }),
      supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', id).eq('role', 'applicant'),
      a.detailed_application_id ? supabaseAdmin.from('applications').select('stripe_payment_status').eq('id', String(a.detailed_application_id)).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const applicants = (stk ?? []).map(s => String(s.name ?? '')).filter(Boolean)
    let association = names.get(code)
    if (!association) { association = await assocName(code); names.set(code, association) }
    const base = { applicationId: id, unit, association, applicants }
    const nDocs = (docs ?? []).length
    const lastDocAt = docs?.[0]?.created_at ? String(docs[0].created_at) : null
    const ageDays = (now - new Date(String(a.created_at)).getTime()) / D
    const idleDays = (now - new Date(String(lastDocAt ?? a.updated_at ?? a.created_at)).getTime()) / D
    const paid = pay?.stripe_payment_status === 'paid'
    const needsFee = await feeRequired(code, type, (a.screening_provider as string | null) ?? null)
    const st = states.get(id) as { screeningValidThrough: string | null; screeningExpired: boolean; complete: boolean } | undefined
    const noticeKind = (a.expiry_notice_kind as NoticeKind | null) ?? null
    const noticeAt = (a.expiry_notice_at as string | null) ?? null
    const dueAt = (a.expiry_due_at as string | null) ?? null

    // 1. An open notice: cleared if the person acted, expired if it ran out.
    if (noticeKind && dueAt) {
      const acted =
        (noticeKind === 'no_files' && nDocs > 0) ||
        (noticeKind === 'unpaid' && paid) ||
        (noticeKind === 'stale' && !!lastDocAt && !!noticeAt && lastDocAt > noticeAt) ||
        (noticeKind === 'screening_expired' && !!lastDocAt && !!noticeAt && lastDocAt > noticeAt)
      if (acted) {
        if (!opts.dry) await supabaseAdmin.from('listing_applications').update({ expiry_notice_kind: null, expiry_notice_at: null, expiry_due_at: null }).eq('id', id)
        actions.push({ ...base, kind: noticeKind, action: 'cleared', detail: 'the person acted after the notice' })
        continue
      }
      // Lease renewal: 24-hour final warning to owner + tenant, once, at the
      // run before the one that would expire it; the expiry is then pinned
      // exactly 24 h after the warning.
      const finalWarnedAt = (a.expiry_final_warned_at as string | null) ?? null
      if (type === 'lease_renewal' && !finalWarnedAt && dueAt <= new Date(now + FINAL_WARNING_LOOKAHEAD_HOURS * H).toISOString()) {
        const expiresAt = new Date(now + FINAL_WARNING_HOURS * H).toISOString()
        const tenantsLabel = applicants.join(' & ')
        const recipients = await recipientsFor(id, type)
        if (opts.dry) { actions.push({ ...base, kind: noticeKind, action: 'would_final_warn', dueAt: expiresAt, to: recipients.map(r => r.email) }); continue }
        const sent: string[] = []
        for (const r of recipients) {
          try {
            const t = r.role === 'owner' ? null : await signPreApplyToken(id, r.stakeholderId)
            const link = t ? `${APP}/pre-apply/${encodeURIComponent(code)}?t=${encodeURIComponent(t)}` : null
            const m = renewalFinalWarningHtml({ to: r.role === 'owner' ? 'owner' : 'tenant', name: r.name, tenants: tenantsLabel, unit, assoc: association, expiresAt, link })
            await sendEmail({ to: [r.email], subject: m.subject, html: m.html }); sent.push(r.email)
          } catch { /* continue */ }
        }
        // Owner not on the application → the owner(s) on file for the unit.
        if (!recipients.some(r => r.role === 'owner')) {
          const owner = await ownerEmailsFor(id, code, unit)
          for (const to of owner.emails) {
            try { const m = renewalFinalWarningHtml({ to: 'owner', name: owner.name, tenants: tenantsLabel, unit, assoc: association, expiresAt, link: null }); await sendEmail({ to: [to], subject: m.subject, html: m.html }); sent.push(to) } catch { /* continue */ }
          }
        }
        await supabaseAdmin.from('listing_applications').update({ expiry_final_warned_at: nowIso, expiry_due_at: expiresAt }).eq('id', id)
        actions.push({ ...base, kind: noticeKind, action: 'final_warning', dueAt: expiresAt, to: sent })
        continue
      }
      if (dueAt <= nowIso) {
        const reason = noticeKind === 'no_files' ? `No document uploaded ${RULE.noFilesNoticeDays} days after the notice`
          : noticeKind === 'unpaid' ? `Background-check fee still unpaid ${RULE.unpaidNoticeHours} hours after the notice`
          : noticeKind === 'stale' ? `Nothing received ${RULE.staleNoticeDays} days after the final notice`
          : `Screening validity expired and no new document within ${RULE.screeningGraceDays} days`
        if (!opts.dry) {
          const r = await closeApplication(id, { mode: 'expired', reason: `${reason} — expired automatically`, requestedBy: 'MAIA auto-expiry', by: 'MAIA' })
          if ('error' in r) { actions.push({ ...base, kind: noticeKind, action: 'expired', detail: `FAILED: ${r.error}` }); continue }
          await supabaseAdmin.from('listing_applications').update({ expired_auto: true }).eq('id', id)
        }
        let notified: string[] = []
        if (type === 'lease_renewal' && !opts.dry) notified = await notifyRenewalExpired({ applicationId: id, code, unit, assoc: association, tenants: applicants.join(' & '), expiredAt: nowIso })
        actions.push({ ...base, kind: noticeKind, action: opts.dry ? 'would_expire' : 'expired', dueAt, detail: reason, to: notified })
        continue
      }
      continue   // notice running, nothing to do today
    }

    // 2. No notice yet: does a rule fire?
    let kind: NoticeKind | null = null, due: Date | null = null
    if (nDocs === 0 && ageDays >= RULE.noFilesAfterDays) { kind = 'no_files'; due = new Date(now + RULE.noFilesNoticeDays * D) }
    else if (needsFee && !paid && ageDays >= RULE.unpaidAfterDays) { kind = 'unpaid'; due = new Date(now + RULE.unpaidNoticeHours * H) }
    else if (st?.screeningValidThrough && st.screeningExpired && !st.complete && (!lastDocAt || lastDocAt < st.screeningValidThrough)) {
      kind = 'screening_expired'; due = new Date(new Date(st.screeningValidThrough).getTime() + RULE.screeningGraceDays * D)
      void isScreeningExpired; void screeningValidThrough
    }
    else if (nDocs > 0 && idleDays >= RULE.staleAfterDays) { kind = 'stale'; due = new Date(now + RULE.staleNoticeDays * D) }
    if (!kind || !due) continue

    const recipients = await recipientsFor(id, type)
    if (opts.dry) { actions.push({ ...base, kind, action: 'would_notice', dueAt: due.toISOString(), to: recipients.map(r => r.email) }); continue }
    const sent: string[] = []
    if (kind !== 'screening_expired') {   // the day-45 email with the re-screen link already went out
      for (const r of recipients) {
        try {
          const t = await signPreApplyToken(id, r.stakeholderId)
          const link = `${APP}/pre-apply/${encodeURIComponent(code)}?t=${encodeURIComponent(t)}`
          const payLink = kind === 'unpaid' ? `${APP}/apply?listingApp=${encodeURIComponent(id)}&assoc=${encodeURIComponent(code)}&unit=${encodeURIComponent(unit ?? '')}&lang=en` : null
          const m = noticeHtml({ kind, name: r.name, unit, assoc: association, dueAt: due.toISOString(), link, payLink })
          await sendEmail({ to: [r.email], subject: m.subject, html: m.html })
          sent.push(r.email)
        } catch { /* one bad address must not stop the run */ }
      }
    }
    await supabaseAdmin.from('listing_applications').update({ expiry_notice_kind: kind, expiry_notice_at: nowIso, expiry_due_at: due.toISOString() }).eq('id', id)
    actions.push({ ...base, kind, action: 'noticed', dueAt: due.toISOString(), to: sent })
  }
  return { checked: (apps ?? []).length, actions }
}
