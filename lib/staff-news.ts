// =====================================================================
// lib/staff-news.ts
//
// "PMI Top Florida Daily News" — the daily (Mon–Fri) staff digest. One
// branded HTML email to the whole team with a section per staff member
// showing week-to-date (Monday → now, America/New_York) ticket + work
// order activity, plus a "Team · Unassigned" catch-all so nothing with
// no assignee hides. Each section links to /improve so anyone can drop
// a "make MAIA better" idea (triaged on /admin/ideas).
//
// Tickets AND work orders both live in `tickets` (type distinguishes
// them); staff attribution is the `assignee_email` string, matched to
// pmi_staff by email local-part (jane@pmitop.com ≡ jane@topflorida…).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchStaffList } from '@/lib/staff-list'
import { sendEmail } from '@/lib/gmail'

const NAVY   = '#1f2a44'
const ORANGE = '#f26a1b'
const RED     = '#b91c1c'
const GREEN   = '#15803d'

// "Late" age fallback (hours) when a ticket has no explicit due_at, by
// priority. due_at, when set, always wins.
const LATE_AGE_HOURS: Record<string, number> = { urgent: 24, high: 72, normal: 168, low: 336 }

const OPEN_STATUSES     = ['open', 'pending', 'waiting_external']
const RESOLVED_STATUSES = ['resolved', 'closed']

export interface NewsMetrics {
  ticketsOpened:   number
  woOpened:        number
  ticketsResolved: number
  woResolved:      number
  ticketsOpen:     number   // currently open (any age)
  woOpen:          number
  ticketsLate:     number   // currently open AND late
  woLate:          number
}

export interface NewsSection {
  name:    string
  email:   string | null   // null for the Unassigned bucket
  role:    string | null
  metrics: NewsMetrics
}

export interface StaffNewsData {
  weekStartIso: string
  generatedIso: string
  sections:     NewsSection[]   // active staff, then Team · Unassigned last
  totals:       NewsMetrics
}

interface TicketRow {
  type:           string | null
  status:         string | null
  priority:       string | null
  created_at:     string | null
  resolved_at:    string | null
  due_at:         string | null
  assignee_email: string | null
}

const localPart = (email: string | null | undefined) =>
  (email ?? '').trim().toLowerCase().split('@')[0]

/** The Daily News is for human staff only. Exclude the MAIA AI bot account
 *  (it's the email-command inbox, not a person) and any other AI/bot/system
 *  entry so it neither gets a section nor receives the email. */
export function isHumanStaff(s: { name?: string | null; email?: string | null; role?: string | null }): boolean {
  if (localPart(s.email) === 'maia') return false
  if (/\b(ai|bot|system|automation)\b/i.test(`${s.role ?? ''} ${s.name ?? ''}`)) return false
  return true
}

const emptyMetrics = (): NewsMetrics => ({
  ticketsOpened: 0, woOpened: 0, ticketsResolved: 0, woResolved: 0,
  ticketsOpen: 0, woOpen: 0, ticketsLate: 0, woLate: 0,
})

// ── ET week boundary ────────────────────────────────────────────────
function etOffsetMin(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5'
  const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
  if (!m) return -300
  const hrs = Number(m[1])
  const mins = Number(m[2] ?? 0) * (hrs < 0 ? -1 : 1)
  return hrs * 60 + mins
}

/** Monday 00:00 America/New_York of `now`'s week, as a UTC Date. */
export function startOfEtWeek(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const y = Number(get('year')), m = Number(get('month')), d = Number(get('day'))
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const daysSinceMon = (((dowMap[get('weekday')] ?? 1) + 6) % 7)
  // ET midnight today → UTC instant (offset taken at local noon to dodge DST edges).
  const offMin = etOffsetMin(new Date(Date.UTC(y, m - 1, d, 12)))
  const todayEtMidnightUtc = Date.UTC(y, m - 1, d) - offMin * 60_000
  return new Date(todayEtMidnightUtc - daysSinceMon * 86_400_000)
}

function isLate(t: TicketRow, nowMs: number): boolean {
  if (t.due_at) return new Date(t.due_at).getTime() < nowMs
  if (!t.created_at) return false
  const ageH = (nowMs - new Date(t.created_at).getTime()) / 3_600_000
  return ageH > (LATE_AGE_HOURS[(t.priority ?? 'normal').toLowerCase()] ?? LATE_AGE_HOURS.normal)
}

/** Pull tickets/WOs and roll them up per staff for the current ET week. */
export async function gatherStaffNews(now = new Date()): Promise<StaffNewsData> {
  const weekStart = startOfEtWeek(now)
  const weekStartIso = weekStart.toISOString()
  const nowMs = now.getTime()

  const staff = (await fetchStaffList()).filter(isHumanStaff)
  // localPart → section index (active staff get their own section).
  const sections: NewsSection[] = staff.map(s => ({
    name: s.name, email: s.email, role: s.role, metrics: emptyMetrics(),
  }))
  const idxByLocal = new Map<string, number>()
  sections.forEach((s, i) => { const lp = localPart(s.email); if (lp) idxByLocal.set(lp, i) })
  const unassigned: NewsSection = { name: 'Team · Unassigned', email: null, role: null, metrics: emptyMetrics() }

  // Rows we need: everything currently open, plus anything opened or
  // resolved since Monday. Skip archived. (Two queries OR-ed in app code
  // is simpler/safer than a complex .or() across nullable columns.)
  const [openRes, weekRes] = await Promise.all([
    supabaseAdmin.from('tickets')
      .select('type,status,priority,created_at,resolved_at,due_at,assignee_email')
      .is('archived_at', null).in('status', OPEN_STATUSES).limit(5000),
    supabaseAdmin.from('tickets')
      .select('type,status,priority,created_at,resolved_at,due_at,assignee_email')
      .is('archived_at', null).in('status', RESOLVED_STATUSES).gte('resolved_at', weekStartIso).limit(5000),
  ])
  const openRows = (openRes.data ?? []) as TicketRow[]
  const weekResolvedRows = (weekRes.data ?? []) as TicketRow[]

  const sectionFor = (t: TicketRow): NewsSection => {
    const i = idxByLocal.get(localPart(t.assignee_email))
    return i != null ? sections[i] : unassigned
  }
  const isWo = (t: TicketRow) => t.type === 'work_order'

  // Currently-open rows: count open + late, and "opened this week" if their
  // created_at is on/after Monday.
  for (const t of openRows) {
    const sec = sectionFor(t)
    if (isWo(t)) { sec.metrics.woOpen++; if (isLate(t, nowMs)) sec.metrics.woLate++ }
    else         { sec.metrics.ticketsOpen++; if (isLate(t, nowMs)) sec.metrics.ticketsLate++ }
    if (t.created_at && t.created_at >= weekStartIso) {
      if (isWo(t)) sec.metrics.woOpened++; else sec.metrics.ticketsOpened++
    }
  }
  // Resolved-this-week rows (these are closed, so not in openRows). Also
  // credit them as "opened this week" if they were both created & resolved
  // within the window.
  for (const t of weekResolvedRows) {
    const sec = sectionFor(t)
    if (isWo(t)) sec.metrics.woResolved++; else sec.metrics.ticketsResolved++
    if (t.created_at && t.created_at >= weekStartIso) {
      if (isWo(t)) sec.metrics.woOpened++; else sec.metrics.ticketsOpened++
    }
  }

  const ordered = [...sections, unassigned]
  const totals = ordered.reduce((acc, s) => {
    for (const k of Object.keys(acc) as (keyof NewsMetrics)[]) acc[k] += s.metrics[k]
    return acc
  }, emptyMetrics())

  return { weekStartIso, generatedIso: now.toISOString(), sections: ordered, totals }
}

// ── Email builder ────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))
}
const etDateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

/** A 4-cell stat row (Opened / Resolved / Open / Late). Late turns red
 *  when there are any; everything else stays navy. */
function metricRow(label: string, opened: number, resolved: number, open: number, late: number): string {
  const cell = (n: number, cap: string, color: string) =>
    `<td align="center" style="padding:8px 4px;border:1px solid #e5e7eb;border-radius:6px;background:#ffffff;width:25%">
       <div style="font-size:18px;font-weight:700;color:${color};line-height:1.1">${n}</div>
       <div style="font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-top:3px">${esc(cap)}</div>
     </td>`
  return `<div style="font-size:11px;font-weight:600;color:${NAVY};margin:10px 0 4px">${esc(label)}</div>
    <table role="presentation" cellpadding="0" cellspacing="4" border="0" width="100%"><tr>
      ${cell(opened, 'Opened', NAVY)}
      ${cell(resolved, 'Resolved', resolved > 0 ? GREEN : NAVY)}
      ${cell(open, 'Open', NAVY)}
      ${cell(late, 'Late', late > 0 ? RED : GREEN)}
    </tr></table>`
}

function sectionBlock(s: NewsSection, appUrl: string): string {
  const m = s.metrics
  const quiet = m.ticketsOpened + m.woOpened + m.ticketsResolved + m.woResolved + m.ticketsOpen + m.woOpen === 0
  const improveUrl = `${appUrl}/improve?from=${encodeURIComponent(s.name)}`
  return `<tr><td style="padding:16px 28px 4px">
    <div style="border:1px solid #e6e8ec;border-radius:10px;padding:14px 16px;background:#fbfcfe">
      <div style="font-size:16px;font-weight:700;color:${NAVY}">${esc(s.name)}${s.role ? `<span style="font-size:11px;font-weight:400;color:#6b7280"> · ${esc(s.role)}</span>` : ''}</div>
      ${quiet ? `<div style="font-size:12px;color:#9ca3af;margin-top:6px">No tickets or work orders this week.</div>` : ''}
      ${metricRow('Tickets', m.ticketsOpened, m.ticketsResolved, m.ticketsOpen, m.ticketsLate)}
      ${metricRow('Work orders', m.woOpened, m.woResolved, m.woOpen, m.woLate)}
      ${s.email ? `<div style="margin-top:10px"><a href="${esc(improveUrl)}" style="font-size:11px;color:${ORANGE};text-decoration:none;font-weight:600">💡 Suggest a MAIA improvement →</a></div>` : ''}
    </div>
  </td></tr>`
}

export function buildStaffNewsEmail(data: StaffNewsData, appUrl: string): { subject: string; html: string; text: string } {
  const dateLabel = etDateLabel(data.generatedIso)
  const t = data.totals
  const subject = `PMI Top Florida Daily News — ${dateLabel}`

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f7;padding:24px 0"><tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:#ffffff;border-radius:10px;max-width:600px;width:100%">

    <tr><td style="background:${NAVY};padding:24px 28px;color:#ffffff;border-top-left-radius:10px;border-top-right-radius:10px">
      <div style="font-size:11px;letter-spacing:0.12em;color:#aab3c5;text-transform:uppercase">PMI Top Florida Properties</div>
      <div style="font-size:23px;font-weight:700;margin-top:6px;color:#ffffff">📣 Daily News</div>
      <div style="font-size:13px;color:#d7dbe4;margin-top:2px">${esc(dateLabel)} · week-to-date since Monday</div>
    </td></tr>

    <tr><td style="padding:18px 28px 0">
      <div style="font-size:11px;font-weight:600;color:${NAVY};margin-bottom:4px">TEAM THIS WEEK</div>
      <table role="presentation" cellpadding="0" cellspacing="4" border="0" width="100%"><tr>
        <td align="center" style="padding:10px 4px;border:1px solid #e5e7eb;border-radius:6px"><div style="font-size:20px;font-weight:700;color:${NAVY}">${t.ticketsOpened + t.woOpened}</div><div style="font-size:9px;color:#6b7280;text-transform:uppercase">Opened</div></td>
        <td align="center" style="padding:10px 4px;border:1px solid #e5e7eb;border-radius:6px"><div style="font-size:20px;font-weight:700;color:${GREEN}">${t.ticketsResolved + t.woResolved}</div><div style="font-size:9px;color:#6b7280;text-transform:uppercase">Resolved</div></td>
        <td align="center" style="padding:10px 4px;border:1px solid #e5e7eb;border-radius:6px"><div style="font-size:20px;font-weight:700;color:${NAVY}">${t.ticketsOpen + t.woOpen}</div><div style="font-size:9px;color:#6b7280;text-transform:uppercase">Open</div></td>
        <td align="center" style="padding:10px 4px;border:1px solid #e5e7eb;border-radius:6px"><div style="font-size:20px;font-weight:700;color:${t.ticketsLate + t.woLate > 0 ? RED : GREEN}">${t.ticketsLate + t.woLate}</div><div style="font-size:9px;color:#6b7280;text-transform:uppercase">Late</div></td>
      </tr></table>
    </td></tr>

    ${data.sections.map(s => sectionBlock(s, appUrl)).join('\n')}

    <tr><td style="padding:16px 28px 22px;border-top:1px solid #eceff4">
      <p style="font-size:11px;color:#9ca3af;margin:14px 0 0">
        "Late" = past its due date, or open longer than its priority window (urgent 1d · high 3d · normal 7d · low 14d).<br/>
        MAIA · PMI Top Florida Properties · <a href="${esc(appUrl)}" style="color:#9ca3af;text-decoration:none">${esc(appUrl.replace(/^https?:\/\//, ''))}</a>
      </p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`

  const text = [
    `PMI Top Florida Daily News — ${dateLabel}`,
    `Week-to-date since Monday.`,
    '',
    ...data.sections.map(s => {
      const m = s.metrics
      return `${s.name}${s.role ? ` (${s.role})` : ''}\n` +
        `  Tickets — opened ${m.ticketsOpened}, resolved ${m.ticketsResolved}, open ${m.ticketsOpen}, late ${m.ticketsLate}\n` +
        `  Work orders — opened ${m.woOpened}, resolved ${m.woResolved}, open ${m.woOpen}, late ${m.woLate}`
    }),
    '',
    `Suggest a MAIA improvement: ${appUrl}/improve`,
    'MAIA · PMI Top Florida Properties',
  ].join('\n')

  return { subject, html, text }
}

// ── Send orchestrator (shared by the cron + the admin "Send now" button) ─
export interface SendDailyNewsResult {
  ok:         boolean
  dry?:       boolean
  reason?:    string
  recipients: string[]
  subject:    string
  totals:     NewsMetrics
}

/** Gather → build → send the Daily News to the human staff shown in it.
 *  Recipients are derived from the rendered sections, so the people who
 *  get the email are exactly the people with a section (bots excluded;
 *  the Unassigned bucket has no email). `dry` builds without sending. */
export async function sendDailyNews(opts: { appUrl: string; dry?: boolean }): Promise<SendDailyNewsResult> {
  const data  = await gatherStaffNews()
  const email = buildStaffNewsEmail(data, opts.appUrl)
  const recipients = Array.from(new Set(
    data.sections.map(s => s.email).filter((e): e is string => !!e),
  ))
  const base = { recipients, subject: email.subject, totals: data.totals }
  if (opts.dry)               return { ok: true, dry: true, ...base }
  if (recipients.length === 0) return { ok: false, reason: 'no human staff recipients', ...base }
  await sendEmail({ to: recipients, subject: email.subject, html: email.html, text: email.text })
  return { ok: true, ...base }
}
