'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Status {
  submitted:   boolean
  authorName:  string | null
  message:     string | null
}

interface Props {
  assoc:  string                 // '' for "all associations"
  month:  string
  status: Status | null          // null = nothing requested yet
}

/** "Message from the Board" panel on the report builder — request a note
 *  from the board president before generating the report. */
export default function BoardMessagePanel({ assoc, month, status }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState<string | null>(null)

  async function request() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/reports/monthly/board-message', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assoc, month }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Could not send the request')
      setMsg(data.alreadySubmitted
        ? 'That board member has already submitted their message.'
        : `✓ Request emailed to ${data.sentTo}. Their note will appear once they reply.`)
      router.refresh()
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Message from the Board</h2>

      {!assoc ? (
        <p className="mt-1 text-xs text-gray-500">
          Pick a single association above to request a board message — it&apos;s per association.
        </p>
      ) : status?.submitted ? (
        <div className="mt-2">
          <div className="text-xs font-medium text-green-700">
            ✓ Message received{status.authorName ? ` from ${status.authorName}` : ''}
          </div>
          {status.message && (
            <blockquote className="mt-1.5 border-l-2 border-[#f26a1b] bg-gray-50 px-3 py-2 text-xs text-gray-600 italic line-clamp-4">
              {status.message}
            </blockquote>
          )}
          <p className="mt-1.5 text-[11px] text-gray-400">
            It will be added to the top of the report when you generate it.
          </p>
        </div>
      ) : status ? (
        <div className="mt-2">
          <p className="text-xs text-amber-700">
            Requested — waiting for {status.authorName ?? 'the board'} to write their message.
          </p>
          <button
            onClick={() => void request()}
            disabled={busy}
            className="mt-2 text-xs font-medium text-[#f26a1b] hover:text-[#d85a14] disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Re-send the request email'}
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-xs text-gray-500">
            Optional — email the board president a link to add a short note that appears at the top
            of this month&apos;s report.
          </p>
          <button
            onClick={() => void request()}
            disabled={busy}
            className="mt-2 rounded bg-[#f26a1b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Request a message from the board'}
          </button>
        </div>
      )}

      {msg && (
        <div className={[
          'mt-2 text-xs',
          msg.startsWith('✗') ? 'text-red-700' : 'text-gray-600',
        ].join(' ')}>
          {msg}
        </div>
      )}
    </section>
  )
}
