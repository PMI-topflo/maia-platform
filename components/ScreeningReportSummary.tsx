// =====================================================================
// components/ScreeningReportSummary.tsx
// Colorful at-a-glance summary of a completed Checkr report — credit
// score plus a badge per section (criminal/eviction/sex offender/
// watchlist/identity/income) — shared by the staff admin detail page and
// the board review page so both see the same thing. User report,
// 2026-09-07: "Does not show her Credit Score number" / "IS very black
// and white, can we create the preview more colourful for my dashboard
// and for the board to review?"
// =====================================================================

import { summarizeReport, creditScoreBand, sectionStatusColors } from '@/lib/screening/report-summary'

export default function ScreeningReportSummary({ reportData }: { reportData: Record<string, unknown> | null | undefined }) {
  const summary = summarizeReport(reportData)
  if (!summary) return null

  const band = summary.creditScore !== null ? creditScoreBand(summary.creditScore) : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0' }}>
      {summary.creditScore !== null && band && (
        <span style={{
          display: 'inline-flex', alignItems: 'baseline', gap: 5,
          font: '700 11px system-ui', borderRadius: 999, padding: '3px 10px',
          color: band.color, background: band.background,
        }}>
          <span style={{ font: '800 14px system-ui' }}>{summary.creditScore}</span>
          credit score · {band.label}
        </span>
      )}
      {summary.creditScore === null && summary.creditFileStatus === 'unavailable' && (
        <span style={{ font: '600 11px system-ui', borderRadius: 999, padding: '3px 10px', color: '#6b7280', background: '#f3f4f6' }}>
          Credit score unavailable
        </span>
      )}
      {summary.sections.map(s => {
        const c = sectionStatusColors(s.status)
        const countLabel = s.recordCount !== null ? ` (${s.recordCount})` : ''
        return (
          <span key={s.key} title={s.label} style={{
            font: '600 11px system-ui', borderRadius: 999, padding: '3px 10px',
            color: c.color, background: c.background,
          }}>
            {c.icon} {s.label}{countLabel}
          </span>
        )
      })}
    </div>
  )
}
