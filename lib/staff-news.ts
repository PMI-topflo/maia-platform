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
const ORANGE = '#e85d26'   // Maia brand orange
const RED     = '#b91c1c'
const GREEN   = '#15803d'

// ── "New in Maia" feed ──────────────────────────────────────────────
// Staff-facing changelog shown at the top of the Daily News. Items
// within the last 7 days render automatically; add new entries here (a
// short, non-technical title + blurb, ISO date) and old ones drop off.
export interface WhatsNewItem { date: string; title: string; blurb: string }
export const WHATS_NEW: WhatsNewItem[] = [
  { date: '2026-06-08', title: 'New look + left menu', blurb: 'A lighter, easier-to-read top bar and a new left sidebar with menus & submenus. Say hi to Maia — your assistant, by PMI Top Florida Properties.' },
  { date: '2026-06-08', title: 'Association Hub', blurb: 'One page per association — board, owners, work orders, financials, documents and reports all together. Open it from Associations → an association.' },
  { date: '2026-06-07', title: 'Work-order photos sync to CINC', blurb: 'Photos you add to a work order now upload into the linked CINC work order automatically.' },
  { date: '2026-06-07', title: 'Faster ticket navigation', blurb: 'Ticket and work-order pages now have ‹ prev / next › arrows (and ← → keys) so you can step through them without going back to the list.' },
  { date: '2026-06-07', title: 'Reconciliation safety check', blurb: 'Marking an invoice paid now asks "Have you marked it PAID IN CINC?" first — so nothing gets marked paid by mistake.' },
  { date: '2026-06-07', title: 'Step through applications & registrations', blurb: 'Use ‹ prev / next › or the arrow keys to review applicants and registrations one at a time.' },
]

/** Items from the last `days` days, newest first. */
export function recentWhatsNew(nowIso: string, days = 7): WhatsNewItem[] {
  const cutoff = new Date(nowIso).getTime() - days * 86_400_000
  return WHATS_NEW
    .filter(i => new Date(`${i.date}T12:00:00Z`).getTime() >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))
}

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

export interface NewsTask { title: string; due: string | null; overdue: boolean }

export interface NewsSection {
  name:    string
  email:   string | null   // null for the Unassigned bucket
  role:    string | null
  metrics: NewsMetrics
  tasks:   NewsTask[]      // "your tasks coming up" (MAIA + manual)
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
    name: s.name, email: s.email, role: s.role, metrics: emptyMetrics(), tasks: [],
  }))
  const idxByLocal = new Map<string, number>()
  sections.forEach((s, i) => { const lp = localPart(s.email); if (lp) idxByLocal.set(lp, i) })
  const unassigned: NewsSection = { name: 'Team · Unassigned', email: null, role: null, metrics: emptyMetrics(), tasks: [] }

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

  // ── "Your tasks coming up" — active staff_tasks per person ──────────
  const todayEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
  const horizon = new Date(nowMs + 10 * 86_400_000)
  const horizonEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(horizon)
  const { data: taskRows } = await supabaseAdmin.from('staff_tasks')
    .select('assignee_email, title, next_due, recurrence').eq('active', true)
  for (const tk of (taskRows ?? []) as { assignee_email: string | null; title: string | null; next_due: string | null; recurrence: string | null }[]) {
    const i = idxByLocal.get(localPart(tk.assignee_email))
    if (i == null || !tk.title) continue
    // show overdue/today, anything due within ~10 days, recurring (daily/weekly), or undated
    const due = tk.next_due
    const recurring = tk.recurrence === 'daily' || tk.recurrence === 'weekly'
    if (due && due > horizonEt && !recurring) continue
    sections[i].tasks.push({ title: tk.title, due, overdue: !!due && due < todayEt })
  }
  for (const s of sections) {
    s.tasks.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    if (s.tasks.length > 6) s.tasks = s.tasks.slice(0, 6)
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

// "Your tasks coming up" — MAIA-generated + manual staff tasks, overdue
// flagged red. Empty → nothing renders.
function tasksBlock(tasks: NewsTask[], appUrl: string): string {
  if (!tasks.length) return ''
  const fmtDue = (t: NewsTask) => {
    if (!t.due) return ''
    const d = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(`${t.due}T12:00:00Z`))
    return `<span style="font-size:10px;color:${t.overdue ? RED : '#6b7280'};font-weight:${t.overdue ? 700 : 400};margin-left:6px">${t.overdue ? 'overdue · ' : ''}${esc(d)}</span>`
  }
  const rows = tasks.map(t => `<div style="padding:4px 0;border-top:1px solid #eef0f4;font-size:12px;color:${NAVY}">
      <span style="color:${ORANGE}">&#10022;</span> ${esc(t.title)}${fmtDue(t)}</div>`).join('')
  return `<div style="margin-top:10px">
    <div style="font-size:11px;font-weight:600;color:${NAVY}">Your tasks coming up</div>
    ${rows}
    <div style="margin-top:6px"><a href="${esc(appUrl)}/admin/staff-setup" style="font-size:10px;color:${ORANGE};text-decoration:none;font-weight:600">Manage tasks →</a></div>
  </div>`
}

function sectionBlock(s: NewsSection, appUrl: string): string {
  const m = s.metrics
  const quiet = m.ticketsOpened + m.woOpened + m.ticketsResolved + m.woResolved + m.ticketsOpen + m.woOpen === 0
  const improveUrl = `${appUrl}/improve?from=${encodeURIComponent(s.name)}`
  // Deep link into MAIA filtered to this person's work (or all tickets for
  // the Unassigned bucket). After login the staff land right here, not the
  // dashboard, thanks to the ?return= handling in the staff login.
  const workUrl = s.email
    ? `${appUrl}/admin/tickets?assignee=${encodeURIComponent(s.email)}`
    : `${appUrl}/admin/tickets`
  const nameHtml = `${esc(s.name)}${s.role ? `<span style="font-size:11px;font-weight:400;color:#6b7280"> · ${esc(s.role)}</span>` : ''}`
  return `<tr><td style="padding:16px 28px 4px">
    <div style="border:1px solid #e6e8ec;border-radius:10px;padding:14px 16px;background:#fbfcfe">
      <div style="font-size:16px;font-weight:700;color:${NAVY}"><a href="${esc(workUrl)}" style="color:${NAVY};text-decoration:none">${nameHtml}</a></div>
      ${quiet ? `<div style="font-size:12px;color:#9ca3af;margin-top:6px">No tickets or work orders this week.</div>` : ''}
      ${metricRow('Tickets', m.ticketsOpened, m.ticketsResolved, m.ticketsOpen, m.ticketsLate)}
      ${metricRow('Work orders', m.woOpened, m.woResolved, m.woOpen, m.woLate)}
      ${tasksBlock(s.tasks, appUrl)}
      <div style="margin-top:10px;font-size:11px">
        <a href="${esc(workUrl)}" style="color:${ORANGE};text-decoration:none;font-weight:600">Open in MAIA →</a>
        ${s.email ? `<a href="${esc(improveUrl)}" style="color:${ORANGE};text-decoration:none;font-weight:600;margin-left:14px">💡 Suggest a MAIA improvement →</a>` : ''}
      </div>
    </div>
  </td></tr>`
}

export function buildStaffNewsEmail(data: StaffNewsData, appUrl: string): { subject: string; html: string; text: string } {
  const dateLabel = etDateLabel(data.generatedIso)
  const t = data.totals
  const subject = `Maia Daily News — ${dateLabel}`
  const news = recentWhatsNew(data.generatedIso)

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f7;padding:24px 0"><tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:#ffffff;border-radius:10px;max-width:600px;width:100%">

    <tr><td style="padding:22px 28px 18px;background:#ffffff;border-bottom:1px solid #ececf0;border-top-left-radius:10px;border-top-right-radius:10px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:12px">
          <img src="${esc(appUrl)}/icon-192.png" width="42" height="42" alt="Maia" style="display:block;border-radius:10px" />
        </td>
        <td style="vertical-align:middle">
          <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.05">Maia <span style="color:${ORANGE}">&#10022;</span></div>
          <div style="font-size:11px;color:#6b7280;letter-spacing:0.03em;margin-top:2px">by PMI Top Florida Properties</div>
        </td>
      </tr></table>
      <div style="font-size:13px;color:#6b7280;margin-top:14px">📣 <strong style="color:#0f172a">Daily News</strong> · ${esc(dateLabel)} · week-to-date since Monday</div>
    </td></tr>

    ${news.length ? `<tr><td style="padding:16px 28px 0">
      <div style="border:1px solid #ffe2d2;border-radius:10px;padding:14px 16px;background:#fff7ed">
        <div style="font-size:13px;font-weight:800;color:${ORANGE}">&#10022; New in Maia &middot; this week</div>
        ${news.map(it => `<div style="padding:8px 0;border-top:1px solid #ffe9da">
          <div style="font-size:13px;font-weight:700;color:${NAVY}">${esc(it.title)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;line-height:1.5">${esc(it.blurb)}</div>
        </div>`).join('')}
      </div>
    </td></tr>` : ''}

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
        Maia · by PMI Top Florida Properties · <a href="${esc(appUrl)}" style="color:#9ca3af;text-decoration:none">${esc(appUrl.replace(/^https?:\/\//, ''))}</a>
      </p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`

  const text = [
    `Maia Daily News — ${dateLabel}`,
    `Week-to-date since Monday.`,
    '',
    ...(news.length ? ['New in Maia this week:', ...news.map(it => `  • ${it.title} — ${it.blurb}`), ''] : []),
    ...data.sections.map(s => {
      const m = s.metrics
      return `${s.name}${s.role ? ` (${s.role})` : ''}\n` +
        `  Tickets — opened ${m.ticketsOpened}, resolved ${m.ticketsResolved}, open ${m.ticketsOpen}, late ${m.ticketsLate}\n` +
        `  Work orders — opened ${m.woOpened}, resolved ${m.woResolved}, open ${m.woOpen}, late ${m.woLate}`
    }),
    '',
    `Suggest a Maia improvement: ${appUrl}/improve`,
    'Maia · by PMI Top Florida Properties',
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
