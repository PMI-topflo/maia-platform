'use client'

import { useState } from 'react'

interface Props {
  token:           string
  initialRating:   number | null
  initialFeedback: string | null
  recipientName:   string | null
}

const RATING_LABEL: Record<number, string> = {
  1: 'Poor',
  2: 'Below expectations',
  3: 'Acceptable',
  4: 'Good',
  5: 'Excellent',
}

export default function FeedbackForm({ token, initialRating, initialFeedback, recipientName }: Props) {
  const [rating,   setRating]   = useState<number>(initialRating ?? 0)
  const [hover,    setHover]    = useState<number>(0)
  const [feedback, setFeedback] = useState<string>(initialFeedback ?? '')
  const [busy,     setBusy]     = useState(false)
  const [done,     setDone]     = useState<boolean>(!!initialRating)
  const [err,      setErr]      = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (rating < 1) { setErr('Pick a rating from 1 to 5 stars.'); return }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/report-feedback/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rating, feedback: feedback.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Could not submit your feedback')
      setDone(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-7 text-center">
        <div className="text-2xl">✓</div>
        <p className="mt-1 text-sm font-semibold text-green-800">
          Thanks{recipientName ? `, ${recipientName}` : ''}!
        </p>
        <p className="mt-1 text-xs text-green-700">
          Your feedback was recorded. You can update it any time by reopening this link.
        </p>
        <button
          onClick={() => setDone(false)}
          className="mt-3 text-xs font-medium text-[#f26a1b] hover:underline"
        >
          Edit my rating
        </button>
      </div>
    )
  }

  const shown = hover || rating

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm font-medium text-gray-800">How was this month&apos;s report?</p>

      <div>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              className={[
                'text-3xl leading-none transition-transform hover:scale-110',
                n <= shown ? 'text-[#f26a1b]' : 'text-gray-300',
              ].join(' ')}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
            >★</button>
          ))}
        </div>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-400">
          {shown > 0 ? `${shown} of 5 · ${RATING_LABEL[shown]}` : 'Tap a star to rate'}
        </p>
      </div>

      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="What worked? What to improve? (Optional)"
        maxLength={4000}
        rows={5}
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#f26a1b] focus:outline-none"
      />

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
      )}

      <button
        type="submit"
        disabled={busy || rating < 1}
        className="w-full rounded-lg bg-[#f26a1b] py-3 text-sm font-semibold text-white hover:bg-[#d85a14] disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit feedback'}
      </button>

      <p className="text-center text-[11px] text-gray-400">
        Your feedback goes only to your PMI management team.
      </p>
    </form>
  )
}
