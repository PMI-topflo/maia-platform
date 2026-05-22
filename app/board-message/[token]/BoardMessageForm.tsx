'use client'

import { useState } from 'react'

interface Props {
  token:           string
  existingMessage: string
}

export default function BoardMessageForm({ token, existingMessage }: Props) {
  const [message, setMessage] = useState(existingMessage)
  const [saving,  setSaving]  = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function submit() {
    if (!message.trim()) { setError('Please write a message.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/board-message/${encodeURIComponent(token)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: message.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error ?? 'Could not save your message')
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-6 text-center">
        <div className="text-2xl">✓</div>
        <p className="mt-1 text-sm font-medium text-green-800">Thank you — your message has been saved.</p>
        <p className="mt-1 text-xs text-green-700">
          It will appear in this month&apos;s management report. You can revise it from this same link any time before the report goes out.
        </p>
        <button
          onClick={() => setDone(false)}
          className="mt-3 text-xs text-green-800 underline hover:no-underline"
        >
          Edit it again
        </button>
      </div>
    )
  }

  return (
    <div>
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        rows={9}
        maxLength={5000}
        placeholder="Write a short note to the community — a few sentences is perfect."
        className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#f26a1b] focus:outline-none"
      />
      <div className="mt-1 text-right text-[11px] text-gray-400">{message.length} / 5000</div>

      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={() => void submit()}
        disabled={saving || !message.trim()}
        className="mt-3 w-full rounded-lg bg-[#f26a1b] py-2.5 text-sm font-semibold text-white hover:bg-[#d85a14] disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save my message'}
      </button>
    </div>
  )
}
