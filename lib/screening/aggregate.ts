// =====================================================================
// lib/screening/aggregate.ts
// Roll several screening_subjects rows (one application can have many —
// each applicant, or each commercial principal) into the single
// applications.screening_status the board/review page already reads.
// =====================================================================

export function computeAggregateStatus(subjectStatuses: string[]): string {
  if (subjectStatuses.length === 0) return 'pending'
  if (subjectStatuses.every(s => s === 'complete')) return 'complete'
  if (subjectStatuses.every(s => s === 'error')) return 'error'
  if (subjectStatuses.some(s => s === 'error')) return 'partial'
  if (subjectStatuses.every(s => s === 'awaiting_consent')) return 'awaiting_consent'
  return 'invited'
}
