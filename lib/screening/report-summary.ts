// =====================================================================
// lib/screening/report-summary.ts
// Pulls the fields staff/board actually want to see at a glance out of
// Checkr's raw report_data JSON (GET /reports/{id} body, stored verbatim
// on screening_subjects.report_data by lib/screening/report-storage.ts).
// Top-level section fields were taken from Checkr's Tenant API reference;
// credit_summary's nested fields (below) were confirmed 2026-09-07
// against a real captured live report (Querline Pinckney, MANXI 912) --
// Checkr's docs only show `credit_summary: { … }` elided, so this is the
// first real confirmation of that shape in this codebase.
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

export interface PaymentTimelineMonth {
  month: string          // "YYYY-MM"
  onTimeRate: number      // percent, 0-100
  lateCount: number
  onTimeCount: number
}

export interface CreditSummary {
  totalAccounts: number | null
  onTimePaymentRate: number | null              // percent, 0-100, trailing ~24mo average
  estimatedMonthlyPaymentCents: number | null
  averageAccountAgeMonths: number | null
  creditUtilizationRate: number | null          // percent, 0-100
  collectionsCount: number | null
  bankruptciesCount: number | null
  chargeOffsCount: number | null
  paymentTimeline: PaymentTimelineMonth[] | null // oldest-first
}

export interface ReportSummary {
  creditScore: number | null
  creditFileStatus: string | null   // 'available' | 'unavailable' | ...
  creditReportStatus: string | null
  creditSummary: CreditSummary | null
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
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function parseCreditSummary(v: unknown): CreditSummary | null {
  const s = asObject(v)
  if (!s) return null
  const utilization = asObject(s.credit_utilization)
  const timeline = Array.isArray(s.payment_timeline)
    ? s.payment_timeline
      .map(m => {
        const o = asObject(m)
        if (!o || typeof o.month !== 'string') return null
        return { month: o.month, onTimeRate: num(o.on_time_rate) ?? 0, lateCount: num(o.late_count) ?? 0, onTimeCount: num(o.on_time_count) ?? 0 }
      })
      .filter((m): m is PaymentTimelineMonth => !!m)
      .reverse()   // Checkr sends newest-first; charts read left-to-right chronologically
    : null
  return {
    totalAccounts: num(s.total_accounts),
    onTimePaymentRate: num(s.on_time_payment_rate),
    estimatedMonthlyPaymentCents: num(s.estimated_monthly_payment_cents),
    averageAccountAgeMonths: num(s.average_account_age_months),
    creditUtilizationRate: utilization ? num(utilization.rate) : null,
    collectionsCount: num(s.collections_count),
    bankruptciesCount: num(s.bankruptcies_count),
    chargeOffsCount: num(s.charge_offs_count),
    paymentTimeline: timeline && timeline.length ? timeline : null,
  }
}

export function summarizeReport(reportData: Record<string, unknown> | null | undefined): ReportSummary | null {
  const data = asObject(reportData)
  if (!data) return null

  const credit = asObject(data.credit_report)
  const creditScore = credit ? num(credit.credit_score) : null
  const creditFileStatus = credit && typeof credit.credit_file_status === 'string' ? credit.credit_file_status : null
  const creditReportStatus = credit && typeof credit.status === 'string' ? credit.status : null
  const creditSummary = credit ? parseCreditSummary(credit.credit_summary) : null

  const sections: ReportSectionSummary[] = (Object.keys(SECTION_LABELS) as ReportSectionKey[]).map(key => {
    const section = asObject(data[key])
    const status = section && typeof section.status === 'string' ? section.status : null
    const records = section?.records
    const recordCount = Array.isArray(records) ? records.length : null
    return { key, label: SECTION_LABELS[key], status, recordCount }
  }).filter(s => s.status !== null)

  if (creditScore === null && sections.length === 0) return null
  return { creditScore, creditFileStatus, creditReportStatus, creditSummary, sections }
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
