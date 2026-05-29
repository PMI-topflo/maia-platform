// =====================================================================
// lib/sunbiz.ts
//
// Florida Sunbiz annual-report deadline logic + shared types, used by
// the /admin/sunbiz tracker, the compliance cron, and the dashboard.
//
// The rules (FL Division of Corporations):
//   • Filing window opens Jan 1.
//   • Annual report is DUE MAY 1 of the report year.
//   • Filed after May 1 → a $400 late fee applies.
//   • Still unfiled by the 4TH FRIDAY OF SEPTEMBER → the entity is
//     ADMINISTRATIVELY DISSOLVED. Several PMI associations have been
//     dissolved this way historically — this is the existential risk
//     the tracker exists to prevent.
//
// This is a 📝 metadata tracker (see COMPLIANCE_TRACKING.md) — no
// document is stored; the Sunbiz confirmation number is the artifact.
// =====================================================================

/** Lead month (1-based) from which an unfiled report is surfaced as
 *  "due soon" and the cron starts alerting. March, per the project plan
 *  ("ticket creation in March"). */
export const SUNBIZ_LEAD_MONTH = 3   // March
export const SUNBIZ_LATE_FEE_USD = 400

export interface AssociationAnnualReport {
  id:                  number
  association_code:    string
  report_year:         number
  filed_date:          string | null   // YYYY-MM-DD; presence => filed
  confirmation_number: string | null
  fee_paid_usd:        number | null
  filed_by_email:      string | null
  notes:               string | null
  created_at:          string
  updated_at:          string
}

export type SunbizStatus =
  | 'filed'             // filed on/before May 1
  | 'late_filed'        // filed after May 1 (late fee paid)
  | 'upcoming'          // not filed, before the lead window
  | 'due_soon'          // not filed, lead window through May 1
  | 'overdue'           // not filed, past May 1 (late fee accruing)
  | 'dissolution_risk'  // not filed, past the 4th-Friday-of-Sept cutoff

/** Calendar year MAIA treats as the active report year. */
export function currentReportYear(now: Date = new Date()): number {
  return now.getFullYear()
}

/** Annual-report due date — May 1 of the report year. */
export function dueDate(year: number): string {
  return `${year}-05-01`
}

/** 4th Friday of September of the report year — administrative
 *  dissolution cutoff. Computed (not hard-coded) so it's correct every
 *  year. */
export function dissolutionDate(year: number): string {
  // Sept = month index 8. Find the first Friday, then add 3 weeks.
  const first = new Date(year, 8, 1)
  const firstFridayOffset = (5 - first.getDay() + 7) % 7  // 5 = Friday
  const day = 1 + firstFridayOffset + 21
  const mm = '09'
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  const t = new Date(now); t.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - t.getTime()) / 86_400_000)
}

/** Derive the filing status for one association's report year. */
export function sunbizStatus(
  year:       number,
  filedDate:  string | null,
  now:        Date = new Date(),
): SunbizStatus {
  const due = dueDate(year)
  if (filedDate) {
    return filedDate > due ? 'late_filed' : 'filed'
  }
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const dueMs = new Date(due).getTime()
  const dissolveMs = new Date(dissolutionDate(year)).getTime()
  const leadMs = new Date(year, SUNBIZ_LEAD_MONTH - 1, 1).getTime()

  if (today.getTime() > dissolveMs) return 'dissolution_risk'
  if (today.getTime() > dueMs)      return 'overdue'
  if (today.getTime() >= leadMs)    return 'due_soon'
  return 'upcoming'
}

/** True when staff should act on this status (drives counts + alerts). */
export function statusNeedsAttention(s: SunbizStatus): boolean {
  return s === 'due_soon' || s === 'overdue' || s === 'dissolution_risk'
}

export function statusLabel(s: SunbizStatus): string {
  return {
    filed: 'Filed', late_filed: 'Filed (late)', upcoming: 'Upcoming',
    due_soon: 'Due soon', overdue: 'Overdue', dissolution_risk: 'Dissolution risk',
  }[s]
}
