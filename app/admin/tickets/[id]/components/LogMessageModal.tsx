'use client'
import { useState } from 'react'

type Direction = 'inbound' | 'outbound'
type Channel   = 'sms' | 'whatsapp' | 'call'

interface Props {
  ticketId:        number
  open:            boolean
  onClose:         () => void
  onSaved:         () => void
  defaultChannel?: Channel
}

function toLocalInputValue(d: Date): string {
  // Convert to the format <input type="datetime-local"> expects in the
  // browser's local timezone.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function LogMessageModal({ ticketId, open, onClose, onSaved, defaultChannel = 'sms' }: Props) {
  const [direction,  setDirection]  = useState<Direction>('inbound')
  const [channel,    setChannel]    = useState<Channel>(defaultChannel)
  const [body,       setBody]       = useState('')
  const [happenedAt, setHappenedAt] = useState(() => toLocalInputValue(new Date()))
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function submit() {
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/log-message`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction,
          channel,
          body,
          happened_at: new Date(happenedAt).toISOString(),
        }),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to log message')
      setBody('')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-5">
        <h3 className="text-lg font-semibold mb-1">Log past message</h3>
        <p className="text-xs text-gray-500 mb-4">
          Record a message that happened outside the platform (e.g. an SMS received on a Dialpad line, a phone call summary). Nothing is sent — this only appears in the timeline.
        </p>

        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDirection('inbound')}
              className={`flex-1 px-3 py-2 rounded text-sm font-medium border ${direction === 'inbound' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}
            >
              📥 Received (from customer)
            </button>
            <button
              type="button"
              onClick={() => setDirection('outbound')}
              className={`flex-1 px-3 py-2 rounded text-sm font-medium border ${direction === 'outbound' ? 'bg-[#f26a1b] text-white border-[#f26a1b]' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}
            >
              📤 Sent (to customer)
            </button>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <label className="text-gray-600 w-20">Channel</label>
            <select
              value={channel}
              onChange={e => setChannel(e.target.value as Channel)}
              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
            >
              <option value="sms">📱 SMS (Dialpad / personal phone)</option>
              <option value="whatsapp">💬 WhatsApp</option>
              <option value="call">📞 Phone call (summary)</option>
            </select>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <label className="text-gray-600 w-20">When</label>
            <input
              type="datetime-local"
              value={happenedAt}
              onChange={e => setHappenedAt(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
            />
          </div>

          <div>
            <label className="text-sm text-gray-600 block mb-1">
              {channel === 'call' ? 'Call summary or transcript' : 'Message text'}
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={5}
              placeholder={channel === 'call' ? 'What was discussed on the call?' : 'Paste the message exactly as it appeared…'}
              className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-[#f26a1b]"
            />
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !body.trim()}
              className="bg-[#f26a1b] text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Log message'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
