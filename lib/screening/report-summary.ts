// =====================================================================
// lib/screening/report-summary.ts
// Pulls the handful of fields staff/board actually want to see at a
// glance out of Checkr's raw report_data JSON (GET /reports/{id} body,
// stored verbatim on screening_subjects.report_data by
// lib/screening/report-storage.ts). Field names below are taken directly
// from Checkr's Tenant API reference (Get report, confirmed 2026-09-07)
// — every field read here is a top-level, always-present key on each
// report section, never a guess at nested/optional shape.
// =====================================================================

export type ReportSectionKey =
  | 'criminal_history' | 'eviction_history' | 'sex_offender_registry'
  | 'global_watchlist' | 'identity_verification' | 'income_verification'

export interface ReportSectionSummary {
  key: ReportSectionKey
  label: string
  status: string | null           // Checkr's own vocabulary: 'clear' | 'consider' | 'pending' | 'suspended' | 'dispute' | ...
  recordCount: number | null      // only meaningful for the four record-list sections
}

export interface CreditScoreBand {
  label: string
  color: string
  background: string
}

export interface ReportSummary {
  creditScore: number | null
  creditFileStatus: string | null   // 'available' | 'unavailable' | ...
  creditReportStatus: string | null
  sections: ReportSectionSummary[]
}

const SECTION_LABELS: Record<ReportSectionKey, string> = {
  criminal_history: 'Criminal History',
  eviction_history: 'Eviction History',
  sex_offender_registry: 'Sex Offender Registry',
  global_watchlist: 'Global Watchlist',
  identity_verification: 'Identity Verification',
  income_verification: 'Income Verification',
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
}

export function summarizeReport(reportData: Record<string, unknown> | null | undefined): ReportSummary | null {
  const data = asObject(reportData)
  if (!data) return null

  const credit = asObject(data.credit_report)
  const creditScore = credit && typeof credit.credit_score === 'number' ? credit.credit_score : null
  const creditFileStatus = credit && typeof credit.credit_file_status === 'string' ? credit.credit_file_status : null
  const creditReportStatus = credit && typeof credit.status === 'string' ? credit.status : null

  const sections: ReportSectionSummary[] = (Object.keys(SECTION_LABELS) as ReportSectionKey[]).map(key => {
    const section = asObject(data[key])
    const status = section && typeof section.status === 'string' ? section.status : null
    const records = section?.records
    const recordCount = Array.isArray(records) ? records.length : null
    return { key, label: SECTION_LABELS[key], status, recordCount }
  }).filter(s => s.status !== null)

  if (creditScore === null && sections.length === 0) return null
  return { creditScore, creditFileStatus, creditReportStatus, sections }
}

// Informational tiers only — standard industry credit-score nomenclature
// (VantageScore/FICO bands), never a pass/fail judgment MAIA renders on
// its own. Staff and the board still make every leasing/purchase decision.
export function creditScoreBand(score: number): CreditScoreBand {
  if (score < 580) return { label: 'Poor', color: '#991b1b', background: '#fee2e2' }
  if (score < 670) return { label: 'Fair', color: '#9a3412', background: '#ffedd5' }
  if (score < 740) return { label: 'Good', color: '#854d0e', background: '#fef9c3' }
  if (score < 800) return { label: 'Very Good', color: '#166534', background: '#dcfce7' }
  return { label: 'Exceptional', color: '#065f46', background: '#d1fae5' }
}

export function sectionStatusColors(status: string | null): { color: string; background: string; icon: string } {
  if (status === 'clear') return { color: '#065f46', background: '#d1fae5', icon: '✓' }
  if (status === 'consider') return { color: '#991b1b', background: '#fee2e2', icon: '⚠' }
  if (status === 'pending') return { color: '#92400e', background: '#fef3c7', icon: '…' }
  if (status === 'suspended' || status === 'dispute') return { color: '#3730a3', background: '#e0e7ff', icon: '⏸' }
  return { color: '#6b7280', background: '#f3f4f6', icon: '·' }
}
