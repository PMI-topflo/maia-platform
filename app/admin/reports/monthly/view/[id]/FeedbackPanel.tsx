// =====================================================================
// Staff-side display of the ratings + feedback recipients have
// submitted for a monthly report. Pure server component — receives the
// rows and renders the aggregate + each response. Renders nothing when
// no one has been emailed yet.
// =====================================================================

import type { ReportFeedbackRow } from '@/lib/report-feedback'

interface Props {
  rows: ReportFeedbackRow[]
}

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} of 5 stars`} className="font-mono">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={i <= n ? 'text-[#f26a1b]' : 'text-gray-300'}>★</span>
      ))}
    </span>
  )
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const KIND_LABEL: Record<'board' | 'owner', string> = {
  board: 'Board',
  owner: 'Owner',
}

export default function FeedbackPanel({ rows }: Props) {
  if (rows.length === 0) return null

  const responses = rows.filter(r => r.rating != null && r.submitted_at)
  if (responses.length === 0) {
    return (
      <div className="print:hidden rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Audience feedback</h2>
        <p className="mt-1 text-xs text-gray-500">
          No ratings yet — recipients can rate at any time using the link in their email.
        </p>
      </div>
    )
  }

  const ratings = responses.map(r => r.rating as number)
  const avg     = ratings.reduce((a, b) => a + b, 0) / ratings.length

  return (
    <div className="print:hidden rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Audience feedback</h2>
        <div className="text-xs text-gray-600">
          <Stars n={Math.round(avg)} />{' '}
          <span className="ml-1 font-medium text-gray-800">{avg.toFixed(1)}</span>
          <span className="text-gray-400"> · {responses.length} of {rows.length} responded</span>
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {responses.map(r => (
          <div key={r.id} className="py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-xs text-gray-700">
                <Stars n={r.rating as number} />
                <span className="ml-2 font-medium text-gray-800">
                  {r.recipient_name ?? r.recipient_email}
                </span>
                {r.recipient_label && (
                  <span className="ml-1 text-gray-400">
                    · {KIND_LABEL[r.recipient_type]} · {r.recipient_label}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-400">
                {r.submitted_at ? fmtDate(r.submitted_at) : ''}
              </div>
            </div>
            {r.feedback && (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-snug text-gray-700">
                {r.feedback}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
