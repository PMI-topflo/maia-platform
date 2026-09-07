'use client'

// =====================================================================
// components/ScreeningReportSummary.tsx
// Colorful at-a-glance summary of a completed Checkr report — credit
// score, credit stat tiles, an on-time-payments trend, and a badge per
// section (criminal/eviction/sex offender/watchlist/identity/income) —
// shared by the staff admin detail page and the board review page so
// both see the same thing. User report, 2026-09-07: "Does not show her
// Credit Score number" / "IS very black and white, can we create the
// preview more colourful for my dashboard and for the board to review?"
//
// User report, same day, AFTER shipping the above: "I still can't see
// the colourful report you created" -- this component was silently
// rendering NOTHING whenever summarizeReport() didn't recognize the
// shape of a given report_data (or it was never fetched at all), with no
// way to tell which. It now always shows something, including a raw-data
// toggle so a real mismatch between Checkr's actual response and the
// field names lib/screening/report-summary.ts expects is visible and
// fixable instead of silent.
//
// User report, same day again, after seeing the raw PDF's own richer
// credit_summary stat tiles (est. monthly payment, total accounts, avg
// account age, credit utilization, an on-time-payments trend line) next
// to this component's plainer badge row: "where do I find [that]" --
// those fields are now confirmed (pasted raw report_data) and rendered
// here too, as their own stat-tile row plus a small trend chart.
// =====================================================================

import { useState, type CSSProperties } from 'react'
import { summarizeReport, creditScoreBand, sectionStatusColors, type CreditSummary } from '@/lib/screening/report-summary'

const tileStyle: CSSProperties = { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', minWidth: 92 }
const tileLabel: CSSProperties = { font: '700 9.5px system-ui', letterSpacing: '.05em', textTransform: 'uppercase', color: '#9ca3af', display: 'block' }
const tileValue: CSSProperties = { font: '700 14px system-ui', color: '#1f2937', fontVariantNumeric: 'tabular-nums' }

function CreditStatTiles({ c }: { c: CreditSummary }) {
  const tiles: { label: string; value: string }[] = []
  if (c.estimatedMonthlyPaymentCents !== null) tiles.push({ label: 'Est. Monthly Payment', value: `$${Math.round(c.estimatedMonthlyPaymentCents / 100)}/mo` })
  if (c.totalAccounts !== null) tiles.push({ label: 'Total Accounts', value: String(c.totalAccounts) })
  if (c.averageAccountAgeMonths !== null) tiles.push({ label: 'Avg Account Age', value: `${(c.averageAccountAgeMonths / 12).toFixed(1)} yrs` })
  if (c.creditUtilizationRate !== null) tiles.push({ label: 'Credit Utilization', value: `${c.creditUtilizationRate}%` })
  if (c.collectionsCount !== null || c.bankruptciesCount !== null) tiles.push({ label: 'Collections / Bankruptcies', value: `${c.collectionsCount ?? 0} / ${c.bankruptciesCount ?? 0}` })
  if (!tiles.length) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      {tiles.map(t => (
        <div key={t.label} style={tileStyle}>
          <span style={tileLabel}>{t.label}</span>
          <span style={tileValue}>{t.value}</span>
        </div>
      ))}
    </div>
  )
}

// A compact, non-interactive trend line — this is a summary preview, not
// an analytics view. Single series, one hue, no legend needed (the label
// above names it); a dashed reference line marks the average, same
// convention Checkr's own PDF uses.
function OnTimePaymentsTrend({ c }: { c: CreditSummary }) {
  if (!c.paymentTimeline || c.paymentTimeline.length < 2 || c.onTimePaymentRate === null) return null
  const W = 220, H = 44, PAD = 4
  const pts = c.paymentTimeline
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + (1 - v / 100) * (H - PAD * 2)
  const path = pts.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(m.onTimeRate).toFixed(1)}`).join(' ')
  const avgY = y(c.onTimePaymentRate)

  return (
    <div style={{ marginTop: 8 }}>
      <span style={tileLabel}>On-Time Payments</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: '700 15px system-ui', color: '#1f2937', fontVariantNumeric: 'tabular-nums' }}>{c.onTimePaymentRate}% avg</span>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`On-time payment rate trend, averaging ${c.onTimePaymentRate}%`}>
          <line x1={PAD} y1={avgY} x2={W - PAD} y2={avgY} stroke="#d1d5db" strokeWidth={1} strokeDasharray="3,3" />
          <path d={path} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((m, i) => (
            <circle key={m.month} cx={x(i)} cy={y(m.onTimeRate)} r={m.lateCount > 0 ? 2.5 : 1.5} fill={m.lateCount > 0 ? '#b91c1c' : '#4f46e5'} />
          ))}
        </svg>
      </div>
    </div>
  )
}

export default function ScreeningReportSummary({ reportData }: { reportData: Record<string, unknown> | null | undefined }) {
  const [showRaw, setShowRaw] = useState(false)
  const summary = summarizeReport(reportData)

  return (
    <div style={{ margin: '4px 0' }}>
      {summary ? (
        <>
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
            {/* The credit report's OWN status can differ from a clean score --
                e.g. Querline's 585 came back "consider," not "clear," because
                of the late-payment months in her timeline below. Worth its
                own badge, not folded into the score pill. */}
            {summary.creditReportStatus && summary.creditReportStatus !== 'clear' && (() => {
              const c = sectionStatusColors(summary.creditReportStatus)
              return (
                <span style={{ font: '600 11px system-ui', borderRadius: 999, padding: '3px 10px', color: c.color, background: c.background }}>
                  {c.icon} Credit Report: {summary.creditReportStatus}
                </span>
              )
            })()}
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
          {summary.creditSummary && <CreditStatTiles c={summary.creditSummary} />}
          {summary.creditSummary && <OnTimePaymentsTrend c={summary.creditSummary} />}
        </>
      ) : (
        <span style={{ font: '600 11px system-ui', borderRadius: 999, padding: '3px 10px', color: '#6b7280', background: '#f3f4f6' }}>
          {reportData ? 'Report summary unavailable — format not recognized' : 'Report summary unavailable — data not retrieved'}
        </span>
      )}
      <button onClick={() => setShowRaw(v => !v)} style={{ display: 'block', marginTop: 6, font: '600 10.5px system-ui', color: '#9ca3af', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
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
