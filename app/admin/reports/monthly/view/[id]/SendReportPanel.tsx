'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { ReportAudience } from '@/lib/monthly-report'
import type { AudienceStat, FeedbackAudience } from '@/lib/report-feedback'

interface Props {
  reportId:          string
  publishedAudience: ReportAudience | null
  boardStat:         AudienceStat
  ownersStat:        AudienceStat
}

const AUDIENCE_LABEL: Record<FeedbackAudience, string> = {
  board:  'Board members',
  owners: 'Unit owners',
}

function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}

/** Send-this-report panel on the staff report view. Lets staff email
 *  the report to the board or to all owners — each row gets a tokenized
 *  feedback link. Disabled until the report is published to that
 *  audience. */
export default function SendReportPanel({ reportId, publishedAudience, boardStat, ownersStat }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<FeedbackAudience | null>(null)
  const [msg,  setMsg]  = useState<string | null>(null)

  const canBoard  = publishedAudience === 'board'  || publishedAudience === 'both'
  const canOwners = publishedAudience === 'owners' || publishedAudience === 'both'

  async function send(audience: FeedbackAudience) {
    setBusy(audience)
    setMsg(null)
    try {
      const res  = await fetch(`/api/admin/reports/monthly/${reportId}/email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ audience }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Send failed')
      const errCount = Array.isArray(data.errors) ? data.errors.length : 0
      setMsg(
        `✓ Sent to ${data.sent}/${data.total} ${AUDIENCE_LABEL[audience].toLowerCase()}` +
        (errCount ? ` (${errCount} failed)` : '') + '.',
      )
      router.refresh()
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  function row(audience: FeedbackAudience, enabled: boolean, stat: AudienceStat) {
    const ratingStr = stat.avgRating != null ? `★ ${stat.avgRating.toFixed(1)}` : ''
    const statusLine = stat.sent === 0
      ? 'Not sent yet'
      : `Sent to ${stat.sent} · ${stat.responded}/${stat.sent} responded` +
        (ratingStr ? ` · ${ratingStr}` : '') +
        (stat.lastSentAt ? ` · last ${fmtDate(stat.lastSentAt)}` : '')
    const btnText = busy === audience
      ? 'Sending…'
      : stat.sent > 0 ? 'Re-send' : 'Send'

    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 py-2 last:border-b-0">
        <div>
          <div className="text-sm font-medium text-gray-800">{AUDIENCE_LABEL[audience]}</div>
          <div className="text-[11px] text-gray-500">{statusLine}</div>
        </div>
        <button
          onClick={() => void send(audience)}
          disabled={!enabled || busy !== null}
          title={enabled ? undefined : `Publish to ${audience} first to enable sending.`}
          className="rounded border border-[#f26a1b] px-3 py-1 text-xs font-medium text-[#f26a1b] hover:bg-[#fff4ec] disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          {btnText}
        </button>
      </div>
    )
  }

  return (
    <div className="print:hidden rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Email this report</h2>
        <span className="text-[11px] text-gray-400">
          Each email includes a tokenized link to rate the report.
        </span>
      </div>
      {row('board',  canBoard,  boardStat)}
      {row('owners', canOwners, ownersStat)}
      {msg && (
        <div className={['mt-2 text-xs', msg.startsWith('✗') ? 'text-red-700' : 'text-gray-600'].join(' ')}>
          {msg}
        </div>
      )}
      {!canBoard && !canOwners && (
        <p className="mt-2 text-[11px] text-gray-400">
          Publish this report to a board or owner audience above to enable sending.
        </p>
      )}
    </div>
  )
}
