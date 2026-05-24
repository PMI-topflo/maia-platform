// =====================================================================
// lib/monthly-report.ts
//
// Gathers the data behind the monthly management report — ticket and
// work-order volume (received vs closed), email-thread volume, and the
// items staff flagged for inclusion. Shared by the report page and the
// AI report-generation route so both see identical numbers.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

// ─────────────────────────────────────────────────────────────────────
// Publish state
// ─────────────────────────────────────────────────────────────────────
export type ReportAudience = 'board' | 'owners' | 'both'

export interface PublishedReportSummary {
  id:                 string
  association_code:   string
  month:              string                // 'YYYY-MM'
  published_at:       string
  published_audience: ReportAudience
}

/** Minimal report shape `canViewPublishedReport` needs. */
export interface ReportAccessSlice {
  association_code:   string
  published_at:       string | null
  published_audience: ReportAudience | null
}

/** Minimal session shape `canViewPublishedReport` needs. Accepts a real
 *  `SessionData` from lib/session, but lets us avoid an import cycle. */
export interface ReportViewerSession {
  persona:         string
  associationCode: string
}

/** True when the logged-in viewer is allowed to see this report.
 *  - staff: always.
 *  - board: report must be published with audience 'board' or 'both'
 *    AND the viewer's association must match the report's.
 *  - owner: same, audience 'owners' or 'both'. */
export function canViewPublishedReport(
  session: ReportViewerSession | null,
  report:  ReportAccessSlice,
): boolean {
  if (!session) return false
  if (session.persona === 'staff') return true
  if (!report.published_at || !report.published_audience) return false
  const viewerAssoc = (session.associationCode ?? '').toUpperCase()
  const reportAssoc = (report.association_code   ?? '').toUpperCase()
  if (!viewerAssoc || viewerAssoc !== reportAssoc) return false
  if (session.persona === 'board')  return report.published_audience === 'board'  || report.published_audience === 'both'
  if (session.persona === 'owner')  return report.published_audience === 'owners' || report.published_audience === 'both'
  return false
}

/** Published reports visible to a persona on an association portal —
 *  used by /board (persona='board') and /my-account (persona='owner'). */
export async function listPublishedReportsFor(
  associationCode: string,
  persona:         'board' | 'owner',
): Promise<PublishedReportSummary[]> {
  const code = (associationCode ?? '').toUpperCase()
  if (!code) return []
  const audiences = persona === 'board' ? ['board', 'both'] : ['owners', 'both']
  const { data, error } = await supabaseAdmin
    .from('monthly_reports')
    .select('id, association_code, month, published_at, published_audience')
    .eq('association_code', code)
    .in('published_audience', audiences)
    .not('published_at', 'is', null)
    .order('month', { ascending: false })
    .limit(24)
  if (error || !data) return []
  return data as PublishedReportSummary[]
}

export interface AssociationActivity {
  code:                 string
  name:                 string
  ticketsReceived:      number
  ticketsClosed:        number
  workOrdersReceived:   number
  workOrdersClosed:     number
  emailThreadsReceived: number
  // Subset of ticketsClosed + workOrdersClosed where created_by_maia=true.
  // Counts every freeform @maia conversation MAIA finished this month.
  maiaResolved:         number
}

export type ActivityTotals = Omit<AssociationActivity, 'code' | 'name'>

// One ticket or work order created in the report month. The report
// covers them all by default (opt-out); `excluded` is set when staff
// untick it in the report preview.
export interface ReportItem {
  id:               number
  ticket_number:    string
  type:             string          // 'ticket' | 'work_order'
  subject:          string | null
  summary:          string | null
  status:           string | null
  priority:         string | null
  association_code: string | null
  created_at:       string
  excluded:         boolean
}

export interface MonthlyReportData {
  month:        string                // 'YYYY-MM'
  monthLabel:   string                // 'March 2026'
  assoc:        string                // association code or '' for all
  activity:     AssociationActivity[] // one row per association with any activity
  totals:       ActivityTotals
  reportItems:  ReportItem[]          // every ticket/WO created this month
}

/** Closed = resolved or closed. */
const CLOSED_STATUSES = ['resolved', 'closed']

/** First instant of `month` (YYYY-MM) and of the month after it. */
function monthWindow(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  return {
    start: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    end:   new Date(Date.UTC(y, m, 1)).toISOString(),
  }
}

/** The current calendar month as YYYY-MM. */
export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/** Paginate a Supabase select fully (PostgREST caps a page at 1000). */
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await run(start, start + 999)
    if (error || !data) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export async function gatherMonthlyReportData(
  assoc: string,
  month: string,
): Promise<MonthlyReportData> {
  const code = assoc.trim().toUpperCase()
  const mon  = /^\d{4}-\d{2}$/.test(month) ? month : currentMonth()
  const { start, end } = monthWindow(mon)

  // ── Tickets / work orders received this month (created_at in window) ──
  //    These rows ARE the report items — every one created in the month;
  //    the report covers them all unless staff exclude them.
  type RawItem = {
    id: number; ticket_number: string; type: string | null
    subject: string | null; summary: string | null; status: string | null
    priority: string | null; association_code: string | null
    created_at: string; excluded_from_monthly_report: boolean | null
  }
  const received = await fetchAll<RawItem>((from, to) => {
    let q = supabaseAdmin
      .from('tickets')
      .select('id, ticket_number, type, subject, summary, status, priority, association_code, created_at, excluded_from_monthly_report')
      .gte('created_at', start).lt('created_at', end)
      .order('association_code', { ascending: true })
      .order('created_at', { ascending: false })
      .range(from, to)
    if (code) q = q.eq('association_code', code)
    return q
  })

  // ── Tickets / work orders closed this month (resolved_at in window) ──
  type ClosedRow = {
    type:             string | null
    association_code: string | null
    created_by_maia:  boolean | null
  }
  const closed = await fetchAll<ClosedRow>((from, to) => {
    let q = supabaseAdmin
      .from('tickets')
      .select('type, association_code, created_by_maia')
      .in('status', CLOSED_STATUSES)
      .gte('resolved_at', start).lt('resolved_at', end)
      .range(from, to)
    if (code) q = q.eq('association_code', code)
    return q
  })

  // ── Inbound email threads this month, attributed to an association ──
  type ERow = { association_code: string | null; gmail_thread_id: string | null }
  const emailRows = await fetchAll<ERow>((from, to) => {
    let q = supabaseAdmin
      .from('email_logs')
      .select('association_code, gmail_thread_id')
      .eq('direction', 'inbound')
      .not('association_code', 'is', null)
      .gte('created_at', start).lt('created_at', end)
      .range(from, to)
    if (code) q = q.eq('association_code', code)
    return q
  })

  // ── Aggregate per association ──
  const byCode = new Map<string, AssociationActivity>()
  const row = (c: string): AssociationActivity => {
    let r = byCode.get(c)
    if (!r) {
      r = {
        code: c, name: c,
        ticketsReceived: 0, ticketsClosed: 0,
        workOrdersReceived: 0, workOrdersClosed: 0,
        emailThreadsReceived: 0,
        maiaResolved: 0,
      }
      byCode.set(c, r)
    }
    return r
  }

  for (const t of received) {
    const r = row(t.association_code ?? '—')
    if (t.type === 'work_order') r.workOrdersReceived++
    else                        r.ticketsReceived++
  }
  for (const t of closed) {
    const r = row(t.association_code ?? '—')
    if (t.type === 'work_order') r.workOrdersClosed++
    else                        r.ticketsClosed++
    if (t.created_by_maia)      r.maiaResolved++
  }
  // Distinct gmail threads per association (a null thread id = its own).
  const seenThreads = new Map<string, Set<string>>()
  for (const e of emailRows) {
    const c = e.association_code ?? '—'
    const key = e.gmail_thread_id ?? `row-${Math.random()}`
    let set = seenThreads.get(c)
    if (!set) { set = new Set(); seenThreads.set(c, set) }
    set.add(key)
  }
  for (const [c, set] of seenThreads) row(c).emailThreadsReceived = set.size

  // ── Association names ──
  const { data: assocRows } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
  const nameOf = new Map<string, string>()
  for (const a of (assocRows ?? []) as Array<{ association_code: string; association_name: string }>) {
    if (a.association_code) nameOf.set(a.association_code, a.association_name)
  }
  for (const r of byCode.values()) r.name = nameOf.get(r.code) ?? r.code

  const activity = Array.from(byCode.values()).sort((a, b) => a.name.localeCompare(b.name))
  const totals: ActivityTotals = {
    ticketsReceived:      activity.reduce((s, r) => s + r.ticketsReceived, 0),
    ticketsClosed:        activity.reduce((s, r) => s + r.ticketsClosed, 0),
    workOrdersReceived:   activity.reduce((s, r) => s + r.workOrdersReceived, 0),
    workOrdersClosed:     activity.reduce((s, r) => s + r.workOrdersClosed, 0),
    emailThreadsReceived: activity.reduce((s, r) => s + r.emailThreadsReceived, 0),
    maiaResolved:         activity.reduce((s, r) => s + r.maiaResolved, 0),
  }

  // ── Report items — every ticket / work order created this month. The
  //    report covers them all; `excluded` rows are the ones staff
  //    unticked in the report preview. ──
  const reportItems: ReportItem[] = received.map(r => ({
    id:               r.id,
    ticket_number:    r.ticket_number,
    type:             r.type ?? 'ticket',
    subject:          r.subject,
    summary:          r.summary,
    status:           r.status,
    priority:         r.priority,
    association_code: r.association_code,
    created_at:       r.created_at,
    excluded:         r.excluded_from_monthly_report === true,
  }))

  return {
    month:        mon,
    monthLabel:   monthLabel(mon),
    assoc:        code,
    activity,
    totals,
    reportItems,
  }
}
