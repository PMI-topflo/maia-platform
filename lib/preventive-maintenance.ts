// =====================================================================
// lib/preventive-maintenance.ts
//
// Pure date math for preventive maintenance schedules — shared by the
// Maintenance calendar (client) and any server callers. NO imports of
// supabase or other server-only modules, so it is safe in the browser.
//
// Schedules store an anchor (start_date) + a cadence; occurrences are
// COMPUTED on demand for a date window (nothing is pre-generated). All
// math is in local calendar dates (no time-of-day), keyed by YYYY-MM-DD.
// =====================================================================

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export interface PreventiveSchedule {
  id:               string
  association_code: string
  task:             string
  cadence:          Cadence
  weekday:          number | null   // 0..6 (Sun..Sat) for weekly
  day_of_month:     number | null   // 1..28 for monthly+
  start_date:       string          // YYYY-MM-DD
  vendor_name:      string | null
  notes:            string | null
  active:           boolean
}

export const CADENCES: Cadence[] = ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual']
export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', annual: 'Annual',
}
// Month step for the non-weekly cadences.
const CADENCE_MONTHS: Record<Exclude<Cadence, 'weekly'>, number> = {
  monthly: 1, quarterly: 3, semiannual: 6, annual: 12,
}
export const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
/** Midnight-local timestamp for a date (drops time-of-day). */
function dayMs(d: Date): number { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }

export interface CalEvent { date: string; scheduleId: string; task: string; cadence: Cadence; vendor: string | null }

/** Occurrences of the active schedules within [start, end] inclusive. */
export function occurrencesInWindow(schedules: PreventiveSchedule[], start: Date, end: Date): CalEvent[] {
  const startMs = dayMs(start)
  const endMs   = dayMs(end)
  const out: CalEvent[] = []

  for (const s of schedules) {
    if (!s.active) continue
    const anchor = parseYmd(s.start_date)
    const push = (d: Date) => out.push({ date: ymd(d), scheduleId: s.id, task: s.task, cadence: s.cadence, vendor: s.vendor_name })

    if (s.cadence === 'weekly') {
      const wd = s.weekday ?? anchor.getDay()
      const cur = new Date(Math.max(startMs, dayMs(anchor)))
      while (cur.getDay() !== wd) cur.setDate(cur.getDate() + 1)
      for (; dayMs(cur) <= endMs; cur.setDate(cur.getDate() + 7)) push(cur)
    } else {
      const step = CADENCE_MONTHS[s.cadence]
      const dom  = Math.min(s.day_of_month ?? anchor.getDate(), 28)
      const occ  = new Date(anchor.getFullYear(), anchor.getMonth(), dom)
      // Wind forward to the first period at/after the anchor that lands in the window.
      while (dayMs(occ) < startMs) occ.setMonth(occ.getMonth() + step)
      for (; dayMs(occ) <= endMs; occ.setMonth(occ.getMonth() + step)) {
        if (dayMs(occ) >= dayMs(anchor)) push(occ)
      }
    }
  }
  return out
}

/** The next occurrence on/after `from` (default today), or null within 2 years. */
export function nextDue(s: PreventiveSchedule, from = new Date()): string | null {
  const end = new Date(from.getFullYear() + 2, from.getMonth(), from.getDate())
  const occ = occurrencesInWindow([s], from, end).sort((a, b) => a.date.localeCompare(b.date))
  return occ[0]?.date ?? null
}

/** Human cadence summary, e.g. "Weekly · Mon" or "Monthly · day 15". */
export function cadenceSummary(s: PreventiveSchedule): string {
  if (s.cadence === 'weekly') return `Weekly · ${WEEKDAY_LABEL[s.weekday ?? parseYmd(s.start_date).getDay()]}`
  const dom = s.day_of_month ?? parseYmd(s.start_date).getDate()
  return `${CADENCE_LABEL[s.cadence]} · day ${Math.min(dom, 28)}`
}
