// Screening validity window — docs/ROADMAP.md's "Screening validity — 45
// days, hardcoded" section. A completed Checkr screening (screening_subjects
// .completed_at, set only by the webhook — see app/api/checkr-webhook/route.ts
// — never by trigger-screening's synchronous order-creation path) is valid
// for SCREENING_VALIDITY_DAYS. Past that, if the application still isn't
// complete, it's expired and a fresh (paid) screening is required to
// continue. Single source of truth so the admin page, board review, the
// board-review-window logic, and the expiry-warning cron all agree on the
// same cutoff.

export const SCREENING_VALIDITY_DAYS = 45

export function screeningValidThrough(completedAt: string | null | undefined): Date | null {
  if (!completedAt) return null
  const d = new Date(completedAt)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + SCREENING_VALIDITY_DAYS)
  return d
}

export function isScreeningExpired(completedAt: string | null | undefined, now: Date = new Date()): boolean {
  const validThrough = screeningValidThrough(completedAt)
  return !!validThrough && now > validThrough
}

/** Days remaining until expiry (negative once past). Used by the warning cron's 10/5/1 checks. */
export function daysUntilScreeningExpiry(completedAt: string | null | undefined, now: Date = new Date()): number | null {
  const validThrough = screeningValidThrough(completedAt)
  if (!validThrough) return null
  return Math.ceil((validThrough.getTime() - now.getTime()) / 86400000)
}
