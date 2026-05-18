// =====================================================================
// app/admin/tickets/[id]/components/ChangeReasonModal.tsx
//
// Generic "when did this happen + why?" modal for status / priority
// changes. Mirrors the DueDateModal pattern but with a free-form
// reason instead of a controlled vocabulary — those changes don't
// feed a KPI report, so the rigor isn't needed.
//
// Flow: TicketDetailClient intercepts the dropdown change, opens this
// modal with the chosen new value. Submitting PATCHes the ticket with
// happened_at + reason; closing reverts the dropdown to its old value.
// =====================================================================

'use client'

import { useRouter } from 'next/navigation'
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'

interface Props {
  ticketId:      number
  field:         'status' | 'priority'
  fromValue:    string
  toValue:      string
  onClose:       (committed: boolean) => void
}

function localInputNow(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const LABELS: Record<Props['field'], string> = {
  status:   'Status',
  priority: 'Priority',
}

export default function ChangeReasonModal({ ticketId, field, fromValue, toValue, onClose }: Props) {
  const router = useRouter()
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [happenedAt,  setHappenedAt]  = useState(localInputNow())
  const [reason,      setReason]      = useState('')
  // Optional "next due date" — when staff moves a ticket to pending /
  // waiting_external they often want to schedule when to check back.
  // Empty = no change to due_at.
  const [nextDueAt,   setNextDueAt]   = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!happenedAt) {
      setError('When did this happen?')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        [field]:     toValue,
        happened_at: new Date(happenedAt).toISOString(),
        reason:      reason.trim() || undefined,
      }
      if (nextDueAt) body.due_at = new Date(nextDueAt).toISOString()

      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      router.refresh()
      onClose(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-20 p-4 overflow-y-auto"
      onClick={() => !submitting && onClose(false)}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Change {LABELS[field].toLowerCase()}
          </h2>
          <button
            onClick={() => !submitting && onClose(false)}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-700">
            {LABELS[field]}: <span className="font-mono">{fromValue.replace('_', ' ')}</span>
            <span className="text-gray-400 mx-2">→</span>
            <span className="font-mono font-semibold">{toValue.replace('_', ' ')}</span>
          </div>

          <Field label="When did this happen? *">
            <input
              type="datetime-local"
              value={happenedAt}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setHappenedAt(e.target.value)}
              required
              max={localInputNow()}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Defaults to now. Backdate if you're recording something that already happened.
            </p>
          </Field>

          <Field label="Next due date (optional)">
            <input
              type="datetime-local"
              value={nextDueAt}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNextDueAt(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              When should staff check back on this? Leave blank to keep the current due date.
            </p>
          </Field>

          <Field label="Reason (optional)">
            <textarea
              value={reason}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              rows={3}
              placeholder="Short note for the audit trail (e.g. vendor confirmed completion, owner reported issue resolved)"
              className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-[#f26a1b]"
            />
          </Field>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !happenedAt}
              className="bg-[#f26a1b] text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14] disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</span>
      {children}
    </label>
  )
}
