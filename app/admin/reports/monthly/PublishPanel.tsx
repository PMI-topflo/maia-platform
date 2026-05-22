'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { ReportAudience } from '@/lib/monthly-report'

interface Props {
  reportId:           string
  associationCode:    string
  publishedAt:        string | null
  publishedAudience:  ReportAudience | null
  publishedByEmail:   string | null
}

const AUDIENCE_LABEL: Record<ReportAudience, string> = {
  board:  'Board',
  owners: 'Owners',
  both:   'Both',
}

/** Publish-state control on the staff report view. Lets staff publish a
 *  report to an audience (board / owners / both), and reverse it. */
export default function PublishPanel({
  reportId, associationCode, publishedAt, publishedAudience, publishedByEmail,
}: Props) {
  const router = useRouter()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [audience,   setAudience]   = useState<ReportAudience>(publishedAudience ?? 'board')
  const [busy,       setBusy]       = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  const isAllReport = associationCode === 'ALL'
  const isPublished = !!publishedAt && !!publishedAudience

  async function publish() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/reports/monthly/${reportId}/publish`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ audience }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Publish failed')
      setPickerOpen(false)
      router.refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function unpublish() {
    if (typeof window !== 'undefined' &&
        !window.confirm('Un-publish this report? It will no longer appear on the audience portal.')) {
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res  = await fetch(`/api/admin/reports/monthly/${reportId}/publish`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Un-publish failed')
      router.refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (isAllReport) {
    return (
      <span className="text-[11px] italic text-gray-400" title="Publishing is per-association.">
        Publishing requires a single association
      </span>
    )
  }

  if (isPublished && publishedAudience) {
    const when = new Date(publishedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full bg-green-100 px-3 py-1 text-[11px] font-medium text-green-800"
          title={publishedByEmail ? `Published by ${publishedByEmail}` : undefined}
        >
          ✓ Published to {AUDIENCE_LABEL[publishedAudience]} · {when}
        </span>
        <button
          onClick={() => void unpublish()}
          disabled={busy}
          className="text-[11px] text-gray-500 hover:text-red-600 disabled:opacity-50"
        >
          {busy ? 'Un-publishing…' : 'Un-publish'}
        </button>
        {err && <span className="text-[11px] text-red-600">{err}</span>}
      </div>
    )
  }

  if (!pickerOpen) {
    return (
      <button
        onClick={() => setPickerOpen(true)}
        className="rounded border border-[#f26a1b] px-3 py-1.5 text-sm font-medium text-[#f26a1b] hover:bg-[#fff4ec]"
      >
        Publish…
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded border border-gray-200 bg-white px-3 py-2">
      <span className="text-[11px] font-medium text-gray-700">Publish to:</span>
      {(['board', 'owners', 'both'] as ReportAudience[]).map(a => (
        <label key={a} className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
          <input
            type="radio"
            name={`audience-${reportId}`}
            value={a}
            checked={audience === a}
            onChange={() => setAudience(a)}
            className="accent-[#f26a1b]"
          />
          {AUDIENCE_LABEL[a]}
        </label>
      ))}
      <button
        onClick={() => void publish()}
        disabled={busy}
        className="rounded bg-[#f26a1b] px-3 py-1 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50"
      >
        {busy ? 'Publishing…' : 'Publish'}
      </button>
      <button
        onClick={() => { setPickerOpen(false); setErr(null) }}
        disabled={busy}
        className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
      >
        Cancel
      </button>
      {err && <span className="w-full text-[11px] text-red-600">{err}</span>}
    </div>
  )
}
