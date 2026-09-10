// =====================================================================
// lib/application-delinquency-notice.ts
//
// User direction, 2026-08-27: when a new application (or a newly-added
// agent) touches a unit whose owner has an OPEN BALANCE MORE THAN 30 DAYS
// old — not just any current balance — don't block the application, warn.
// The owner is told the application won't be approved until the balance is
// settled; the applicant/agent are told the owner has an account issue that
// may restrict approval, they may continue at their own risk (no refunds),
// and to contact the owner directly.
//
// The 30-day aging check reuses the SAME ledger data + RunningBalance sign
// convention the owner statement already computes from
// (lib/owner-ledger.ts's normalizeLedger) — never a second, different
// definition of "delinquent." Distinct from lib/owner-ledger-flow.ts's
// isAccountInCollections(), which is a different signal (the formal
// collections-workflow flag / "Block Payments" toggle) used for the
// ledger/IVR payment-blocking flow — this one is purely about balance age.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { getHomeownerLedger } from '@/lib/integrations/cinc'
import { normalizeLedger } from '@/lib/owner-ledger'

const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const firstEmail = (raw: unknown) => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  return s.split(/[,;\s]+/).map(x => x.trim()).find(x => x.includes('@')) ?? null
}

/** True once an account has been continuously in a positive (owed) balance
 *  for more than 30 days — not just "has some balance right now." Walks the
 *  homeowner ledger for the last date `RunningBalance` was at $0-or-below;
 *  if that was over 30 days ago (or never, within the 2-year lookback) and
 *  the CURRENT balance is still positive, it's aged past 30 days. Fails
 *  CLOSED (treats as not delinquent) on any CINC error or empty ledger — an
 *  outage or a unit CINC has no history for must never scare an applicant. */
export interface BalanceAging {
  /** Balance owed today (positive means the owner owes). */
  balance: number
  /** ISO date the balance has been continuously above zero since (the day
   *  after the last $0 line, or the first ledger line in the lookback). */
  since: string
  /** Whole days from `since` to today. */
  days: number
}

/** The balance-aging facts behind the notices: current owed balance and how
 *  long it has been continuously above zero. Null when there is nothing
 *  owed, the ledger is empty, or CINC errors — fails CLOSED, same as the
 *  boolean below. */
export async function openBalanceAging(assoc: string, account: string): Promise<BalanceAging | null> {
  try {
    const today = new Date()
    const from = new Date(today); from.setUTCFullYear(from.getUTCFullYear() - 2)
    const fromDate = from.toISOString().slice(0, 10)
    const toDate = today.toISOString().slice(0, 10)
    const rows = await getHomeownerLedger({ assocCode: assoc, hoId: account, fromDate, toDate })
    const lines = normalizeLedger(rows, fromDate, toDate)
    if (!lines.length) return null
    const current = lines[lines.length - 1].balance
    if (current <= 0) return null
    let lastZero: string | null = null
    for (const l of lines) if (l.balance <= 0) lastZero = l.date
    // The balance became positive on the first charge AFTER the last $0 line
    // (that is the date the owner will recognise on their statement).
    const firstOwed = lastZero ? lines.find(l => l.date > lastZero! && l.balance > 0)?.date ?? lastZero : lines[0].date
    const days = (Date.now() - new Date(`${firstOwed}T00:00:00Z`).getTime()) / 86_400_000
    return { balance: current, since: firstOwed, days }
  } catch { return null }
}

/** True once an account has been continuously in a positive (owed) balance
 *  for more than 30 days — not just "has some balance right now." User
 *  decision, 2026-09-10: this threshold stays at 30 days. */
export async function isOpenBalanceOver30Days(assoc: string, account: string): Promise<boolean> {
  const aging = await openBalanceAging(assoc, account)
  return !!aging && aging.days > 30
}

interface OwnerContact { name: string; email: string }

export async function resolveUnit(assoc: string, unit: string): Promise<{ owners: OwnerContact[]; accountNumber: string | null; assocName: string }> {
  const code = assoc.toUpperCase()
  const [{ data: ownerRows }, { data: assocRow }] = await Promise.all([
    supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, unit_number, account_number, status').eq('association_code', code),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', code).maybeSingle(),
  ])
  const rows = (ownerRows ?? []).filter(o =>
    (o.status ?? null) !== 'previous' &&
    (String(o.unit_number ?? '') === unit || String(o.account_number ?? '').toUpperCase() === `${code}${unit}`.toUpperCase()))
  const owners: OwnerContact[] = []
  for (const o of rows) {
    const email = firstEmail(o.emails)
    if (!email) continue
    owners.push({ name: String(o.entity_name ?? '') || [o.first_name, o.last_name].filter(Boolean).join(' ').trim() || 'Owner', email })
  }
  const accountNumber = rows.find(o => o.account_number)?.account_number ? String(rows.find(o => o.account_number)!.account_number) : null
  const assocName = (assocRow?.association_name as string | null) ?? code
  return { owners, accountNumber, assocName }
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })

// User direction, 2026-09-10 (MANXI 603): the OWNER's notice states the
// amount and since when, so nobody has to guess what "account issue" means.
// The applicant/agent risk notice deliberately stays vague — the owner's
// balance is the owner's business.
function ownerNoticeHtml(o: { unit: string; assocName: string; aging: BalanceAging | null }): string {
  const detail = o.aging
    ? `Your account currently shows an open balance of <strong>${esc(money(o.aging.balance))}</strong>, unpaid since <strong>${esc(longDate(o.aging.since))}</strong> (${Math.floor(o.aging.days)} days).`
    : `Your account currently shows an <strong>open balance more than 30 days past due</strong>.`
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Dear Owner,</p>
    <p>We've received a new application for <strong>Unit ${esc(o.unit)}</strong> at <strong>${esc(o.assocName)}</strong>.</p>
    <p>${detail} This application <strong>cannot be approved until the balance is settled</strong>.</p>
    <p>Please contact us to resolve this so the application can move forward.</p>
    <p style="margin:4px 0">✉ <a href="mailto:ar@topfloridaproperties.com">ar@topfloridaproperties.com</a> · ☎ (305) 900-5077</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
}
function riskNoticeHtml(o: { unit: string; assocName: string }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Hello,</p>
    <p>This is regarding the application for <strong>Unit ${esc(o.unit)}</strong> at <strong>${esc(o.assocName)}</strong>.</p>
    <p>The owner of this unit currently has an account issue that <strong>may restrict approval</strong> of this application. You may continue with the approval process, but <strong>at your own risk — no refunds</strong> will be issued if the application cannot be approved as a result.</p>
    <p>Please contact the owner directly for further information.</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
}

/** Fired once, at the moment a new application is opened for a unit
 *  (createIntake). Checks the owner's balance aging and, if past 30 days,
 *  emails every owner (settle-balance notice) and the applicant just added
 *  (risk notice). Best-effort — never throws, never blocks the caller. */
export async function notifyDelinquencyOnApplicationOpen(input: {
  associationCode: string; unitLabel: string; applicant: { name: string; email: string | null }
}): Promise<void> {
  try {
    const { owners, accountNumber, assocName } = await resolveUnit(input.associationCode, input.unitLabel)
    if (!accountNumber) return
    const aging = await openBalanceAging(input.associationCode, accountNumber)
    if (!aging || aging.days <= 30) return

    for (const o of owners) {
      try { await sendEmail({ to: o.email, subject: `Application on Unit ${input.unitLabel} — outstanding balance of ${money(aging.balance)} must be resolved`, html: ownerNoticeHtml({ unit: input.unitLabel, assocName, aging }) }) } catch { /* continue */ }
    }
    if (input.applicant.email) {
      try { await sendEmail({ to: input.applicant.email, subject: `Application on Unit ${input.unitLabel} — important notice`, html: riskNoticeHtml({ unit: input.unitLabel, assocName }) }) } catch { /* continue */ }
    }
  } catch { /* never block application creation on this */ }
}

/** Fired when an agent (listing_agent or applicant_agent) is newly set or
 *  changed on an EXISTING application — re-checks the same signal and, if
 *  still delinquent, sends just that agent the risk notice. Does not
 *  re-notify the owner (createIntake already did, once). */
export async function notifyAgentIfDelinquent(input: {
  associationCode: string; unitLabel: string; agent: { email: string | null }
}): Promise<void> {
  try {
    if (!input.agent.email) return
    const { accountNumber, assocName } = await resolveUnit(input.associationCode, input.unitLabel)
    if (!accountNumber) return
    if (!(await isOpenBalanceOver30Days(input.associationCode, accountNumber))) return
    await sendEmail({ to: input.agent.email, subject: `Application on Unit ${input.unitLabel} — important notice`, html: riskNoticeHtml({ unit: input.unitLabel, assocName }) })
  } catch { /* never block the agent save on this */ }
}
