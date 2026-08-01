// =====================================================================
// lib/compliance-owner-audit.ts
// Scan units for missing required documents and email each owner their
// self-service link (/owner/compliance/<token>), pacing reminders so nobody
// is spammed. Safe by design: capped per run, scoped per association,
// cadence-gated, and gated behind OWNER_AUDIT_ENABLED for live sends.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { signOwnerComplianceToken } from '@/lib/owner-portal-token'
import { getUnitComplianceState } from '@/lib/unit-required-docs'
import { sendEmail } from '@/lib/gmail'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const REMINDER_DAYS = 14
const MAX_SENDS = 4
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

function firstEmail(emails: string | null): string | null {
  if (!emails) return null
  return emails.split(/[,;\s]+/).map(s => s.trim()).find(e => e.includes('@')) ?? null
}

export interface AuditResult {
  scanned: number; needDocs: number; eligible: number; sent: number
  samples: { account: string; email: string | null; missing: string[] }[]
}

function complianceEmailHtml(opts: { name: string; associationName: string; missing: { label: string }[]; link: string; surveyMode?: boolean }): { subject: string; html: string } {
  const subject = opts.surveyMode
    ? `Quick survey — occupancy & insurance for your unit at ${opts.associationName}`
    : `Documents needed for your unit — ${opts.associationName}`
  const intro = opts.surveyMode
    ? `<p>PMI Top Florida Properties manages <strong>${esc(opts.associationName)}</strong>. We're updating our records — please confirm how your unit is used and what insurance you carry, and upload anything below we don't already have on file:</p>`
    : `<p>PMI Top Florida Properties manages <strong>${esc(opts.associationName)}</strong>. To keep your unit file current, we still need:</p>`
  const list = opts.missing.length > 0 ? `<ul>${opts.missing.map(m => `<li>${esc(m.label)}</li>`).join('')}</ul>` : ''
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Hello${opts.name ? ` ${esc(opts.name)}` : ''},</p>
    ${intro}
    ${list}
    <p style="margin:22px 0"><a href="${opts.link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">${opts.surveyMode ? 'Take the survey →' : 'Confirm &amp; upload →'}</a></p>
    <p style="color:#6b7280;font-size:12px">No account needed. This link is specific to your unit and expires in 30 days.</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
  return { subject, html }
}

// ---------------------------------------------------------------------
// Emergency-contact annual renewal.
// The emergency contact is re-confirmed once a year (owner-compliance save
// stamps unit.emergency with expiry = +1yr). This scan finds units whose
// emergency contact is expiring soon or already expired and emails the owner
// their self-service link asking them to confirm or update it. Paced via the
// shared owner_compliance_requests.last_sent_at so it never stacks with the
// missing-docs audit. Gated behind OWNER_AUDIT_ENABLED for live sends.
// ---------------------------------------------------------------------
const RENEW_WINDOW_DAYS = 45   // start nudging this far before expiry
const RENEW_COOLDOWN_DAYS = 21 // don't re-email the same unit within this window

function emergencyRenewalHtml(opts: { name: string; associationName: string; link: string; expired: boolean }): { subject: string; html: string } {
  const subject = `Please confirm your emergency contact — ${opts.associationName}`
  const lead = opts.expired
    ? `the emergency contact we have on file for your unit is now out of date`
    : `the emergency contact we have on file for your unit is due for its yearly review`
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Hello${opts.name ? ` ${esc(opts.name)}` : ''},</p>
    <p>PMI Top Florida Properties manages <strong>${esc(opts.associationName)}</strong>. Our records show ${lead}. Please take a moment to confirm it's still correct — or update it if anything has changed:</p>
    <p style="margin:22px 0"><a href="${opts.link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Confirm emergency contact →</a></p>
    <p style="color:#6b7280;font-size:12px">No account needed. This link is specific to your unit and expires in 30 days.</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
  return { subject, html }
}

export interface RenewalResult {
  scanned: number; eligible: number; sent: number
  samples: { account: string; email: string | null; expired: boolean }[]
}

export async function runEmergencyContactRenewal(opts: { assoc?: string | null; dryRun?: boolean; limit?: number } = {}): Promise<RenewalResult> {
  const res: RenewalResult = { scanned: 0, eligible: 0, sent: 0, samples: [] }
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + RENEW_WINDOW_DAYS)
  const cutoffISO = cutoff.toISOString().slice(0, 10)
  const todayISO = new Date().toISOString().slice(0, 10)

  let q = supabaseAdmin.from('compliance_records')
    .select('association_code, unit_ref, expiry_date')
    .eq('scope', 'unit').eq('item_key', 'unit.emergency').eq('applicable', true)
    .not('expiry_date', 'is', null).lte('expiry_date', cutoffISO)
    .order('expiry_date', { ascending: true }).limit(opts.limit ?? 200)
  if (opts.assoc) q = q.eq('association_code', opts.assoc)
  const { data: rows } = await q
  res.scanned = (rows ?? []).length

  const cool = new Date(); cool.setDate(cool.getDate() - RENEW_COOLDOWN_DAYS)
  const coolISO = cool.toISOString()

  for (const r of rows ?? []) {
    const assoc = String(r.association_code); const account = String(r.unit_ref)
    const { data: o } = await supabaseAdmin.from('owners')
      .select('emails, first_name, last_name, association_name')
      .eq('association_code', assoc).eq('account_number', account).maybeSingle()
    const email = firstEmail((o?.emails as string | null) ?? null)
    if (!o || !email) continue

    // Pace: skip if this unit was emailed within the cooldown window.
    const { data: req } = await supabaseAdmin.from('owner_compliance_requests')
      .select('last_sent_at, send_count').eq('association_code', assoc).eq('unit_ref', account).maybeSingle()
    if (req?.last_sent_at && String(req.last_sent_at) > coolISO) continue

    res.eligible++
    const expired = String(r.expiry_date) < todayISO
    if (opts.dryRun) { if (res.samples.length < 25) res.samples.push({ account, email, expired }); res.sent++; continue }

    const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
    const link = `${APP}/owner/compliance/${await signOwnerComplianceToken(assoc, account)}`
    const { subject, html } = emergencyRenewalHtml({ name, associationName: (o.association_name as string | null) ?? assoc, link, expired })
    try { await sendEmail({ to: email, subject, html }) } catch { continue }
    await supabaseAdmin.from('owner_compliance_requests').upsert(
      { association_code: assoc, unit_ref: account, last_sent_at: new Date().toISOString(), send_count: (req?.send_count ?? 0) + 1 },
      { onConflict: 'association_code,unit_ref' },
    ).then(() => null, () => null)
    if (res.samples.length < 25) res.samples.push({ account, email, expired })
    res.sent++
  }
  return res
}

/** Explicit staff-triggered single-unit resend — from the /admin/unit-status
 *  detail modal's "Resend request" button. Bypasses the cadence/cap gate
 *  that governs the automated audit, since a staffer clicking this wants it
 *  to go out now regardless of the 14-day cooldown. Still records the send
 *  so the automated audit's own pacing stays accurate afterward. */
export async function sendOwnerComplianceLinkNow(assoc: string, account: string): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const { data: o } = await supabaseAdmin.from('owners')
    .select('emails, first_name, last_name, association_name').eq('association_code', assoc).eq('account_number', account).maybeSingle()
  if (!o) return { ok: false, error: 'owner not found' }
  const email = firstEmail(o.emails as string | null)
  if (!email) return { ok: false, error: 'owner has no email on file' }

  const { missing } = await getUnitComplianceState(assoc, account)
  const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
  const link = `${APP}/owner/compliance/${await signOwnerComplianceToken(assoc, account)}`
  const { subject, html } = complianceEmailHtml({ name, associationName: (o.association_name as string | null) ?? assoc, missing, link })

  try {
    await sendEmail({ to: email, subject, html })
  } catch (e) {
    return { ok: false, error: `send failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  const { data: req } = await supabaseAdmin.from('owner_compliance_requests')
    .select('send_count').eq('association_code', assoc).eq('unit_ref', account).maybeSingle()
  await supabaseAdmin.from('owner_compliance_requests').upsert(
    { association_code: assoc, unit_ref: account, last_sent_at: new Date().toISOString(), send_count: (req?.send_count ?? 0) + 1, resolved_at: null },
    { onConflict: 'association_code,unit_ref' },
  ).then(() => null, () => null)

  return { ok: true, sentTo: email }
}

/** opts.surveyMode: sends to EVERY active owner regardless of whether their
 *  file is already complete (an explicit occupancy/insurance-type survey
 *  campaign, staff-triggered from /admin/unit-status) — the normal mode
 *  only reaches out when something's missing. Both modes share the same
 *  owner_compliance_requests cadence/cap so a survey send doesn't re-spam
 *  someone the automated audit already reached this cycle. */
export async function runOwnerComplianceAudit(opts: { assoc?: string | null; dryRun?: boolean; limit?: number; surveyMode?: boolean } = {}): Promise<AuditResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
  let q = supabaseAdmin.from('owners')
    .select('account_number, association_code, emails, first_name, last_name, association_name')
    .or('status.neq.previous,status.is.null')
  if (opts.assoc) q = q.eq('association_code', opts.assoc.toUpperCase())
  const { data } = await q
  const owners = (data ?? []) as { account_number: string | null; association_code: string; emails: string | null; first_name: string | null; last_name: string | null; association_name: string | null }[]

  const seen = new Set<string>()
  const res: AuditResult = { scanned: 0, needDocs: 0, eligible: 0, sent: 0, samples: [] }

  for (const o of owners) {
    if (!o.account_number) continue
    const key = `${o.association_code}:${o.account_number}`
    if (seen.has(key)) continue
    seen.add(key)
    res.scanned++

    const { missing } = await getUnitComplianceState(o.association_code, o.account_number)
    // Mark resolved + skip when the unit's file is complete — unless this is
    // a deliberate survey send, which goes out to everyone regardless.
    if (missing.length === 0) {
      await supabaseAdmin.from('owner_compliance_requests')
        .update({ resolved_at: new Date().toISOString() })
        .eq('association_code', o.association_code).eq('unit_ref', o.account_number).is('resolved_at', null)
        .then(() => null, () => null)
      if (!opts.surveyMode) continue
    }
    res.needDocs++
    const email = firstEmail(o.emails)
    if (!email) continue

    const { data: req } = await supabaseAdmin.from('owner_compliance_requests')
      .select('last_sent_at, send_count').eq('association_code', o.association_code).eq('unit_ref', o.account_number).maybeSingle()
    const recently = req?.last_sent_at && (Date.now() - new Date(req.last_sent_at as string).getTime()) < REMINDER_DAYS * 86_400_000
    const maxed = (req?.send_count ?? 0) >= MAX_SENDS
    if (recently || maxed) continue
    res.eligible++

    if (res.sent >= limit) continue
    if (opts.dryRun) { if (res.samples.length < 25) res.samples.push({ account: o.account_number, email, missing: missing.map(m => m.label) }); res.sent++; continue }

    const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
    const link = `${APP}/owner/compliance/${await signOwnerComplianceToken(o.association_code, o.account_number)}`
    const { subject, html } = complianceEmailHtml({ name, associationName: o.association_name ?? o.association_code, missing, link, surveyMode: opts.surveyMode })
    await sendEmail({ to: email, subject, html }).then(() => { res.sent++ }, () => null)

    await supabaseAdmin.from('owner_compliance_requests').upsert(
      { association_code: o.association_code, unit_ref: o.account_number, last_sent_at: new Date().toISOString(), send_count: (req?.send_count ?? 0) + 1, resolved_at: null },
      { onConflict: 'association_code,unit_ref' },
    ).then(() => null, () => null)
  }

  return res
}
