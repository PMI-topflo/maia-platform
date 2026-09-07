'use client'

// =====================================================================
// components/ScreeningReportSummary.tsx
// Colorful at-a-glance summary of a completed Checkr report — credit
// score plus a badge per section (criminal/eviction/sex offender/
// watchlist/identity/income) — shared by the staff admin detail page and
// the board review page so both see the same thing. User report,
// 2026-09-07: "Does not show her Credit Score number" / "IS very black
// and white, can we create the preview more colourful for my dashboard
// and for the board to review?"
//
// User report, same day, AFTER shipping the above: "I still can't see
// the colourful report you created" -- this component was silently
// rendering NOTHING whenever summarizeReport() didn't recognize the
// shape of a given report_data (or it was never fetched at all), with no
// way to tell which. It now always shows something, including a raw-data
// toggle so a real mismatch between Checkr's actual response and the
// field names lib/screening/report-summary.ts expects is visible and
// fixable instead of silent.
// =====================================================================

import { useState } from 'react'
import { summarizeReport, creditScoreBand, sectionStatusColors } from '@/lib/screening/report-summary'

export default function ScreeningReportSummary({ reportData }: { reportData: Record<string, unknown> | null | undefined }) {
  const [showRaw, setShowRaw] = useState(false)
  const summary = summarizeReport(reportData)

  return (
    <div style={{ margin: '4px 0' }}>
      {summary ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {summary.creditScore !== null && (() => {
            const band = creditScoreBand(summary.creditScore)
            return (
              <span style={{
                display: 'inline-flex', alignItems: 'baseline', gap: 5,
                font: '700 11px system-ui', borderRadius: 999, padding: '3px 10px',
                color: band.color, background: band.background,
              }}>
                <span style={{ font: '800 14px system-ui' }}>{summary.creditScore}</span>
                credit score · {band.label}
              </span>
            )
          })()}
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
      ) : (
        <span style={{ font: '600 11px system-ui', borderRadius: 999, padding: '3px 10px', color: '#6b7280', background: '#f3f4f6' }}>
          {reportData ? 'Report summary unavailable — format not recognized' : 'Report summary unavailable — data not retrieved'}
        </span>
      )}
      <button onClick={() => setShowRaw(v => !v)} style={{ display: 'block', marginTop: 4, font: '600 10.5px system-ui', color: '#9ca3af', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        {showRaw ? '▾ Hide raw report data' : '▸ Show raw report data'}
      </button>
      {showRaw && (
        <pre style={{ margin: '4px 0 0', padding: 8, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, font: '10.5px ui-monospace,monospace', color: '#374151', maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {reportData ? JSON.stringify(reportData, null, 2) : '(no report data stored for this subject)'}
        </pre>
      )}
    </div>
  )
}
