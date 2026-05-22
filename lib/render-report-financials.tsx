// =====================================================================
// lib/render-report-financials.tsx
//
// Presentational components for the monthly-report financial section —
// the headline figures MAIA extracted from the uploaded CINC statement.
// Pure (no hooks), so they render in both server and client components
// (the report view page and the builder panel).
// =====================================================================

import type { FinancialFigures } from '@/lib/report-financials'

/** A responsive grid of figure cards — value over label. */
export function FinancialFiguresGrid({ figures }: { figures: FinancialFigures }) {
  if (figures.headline.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {figures.headline.map((f, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-[#f8f9fb] px-3 py-3">
          <div className="text-[17px] font-bold leading-tight text-[#1f2a44]">{f.value}</div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">{f.label}</div>
          {f.note && <div className="mt-0.5 text-[10px] leading-snug text-gray-400">{f.note}</div>}
        </div>
      ))}
    </div>
  )
}

/** The full newsletter "Financial Summary" section — heading with the
 *  orange underline, the figure grid, an optional note, and a link to
 *  the source statement PDF. Used on the monthly-report view page. */
export function FinancialSummarySection({
  figures,
  pdfHref,
}: {
  figures: FinancialFigures
  pdfHref?: string | null
}) {
  if (figures.headline.length === 0) return null
  return (
    <div className="report-block mt-7">
      <h2 className="report-heading mb-2.5 flex items-center justify-between gap-2 border-b-2 border-[#f26a1b] pb-1.5">
        <span className="text-base font-semibold text-[#1f2a44]">
          Financial Summary{figures.period_label ? ` — ${figures.period_label}` : ''}
        </span>
        {pdfHref && (
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[11px] font-medium text-[#f26a1b] hover:underline print:hidden"
          >
            Statement PDF ↗
          </a>
        )}
      </h2>
      <FinancialFiguresGrid figures={figures} />
      {figures.notes && (
        <p className="mt-2.5 text-xs italic leading-relaxed text-gray-500">{figures.notes}</p>
      )}
    </div>
  )
}
