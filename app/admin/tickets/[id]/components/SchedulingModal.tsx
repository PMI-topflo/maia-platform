// =====================================================================
// app/admin/tickets/[id]/components/SchedulingModal.tsx
//
// Edit the Scheduled date on a work order. PATCHes the WO's details
// row; if the ticket is synced to CINC, the outbox handler pushes the
// new IssuedDate to CINC's PATCH /workOrderDetails.
// =====================================================================

'use client'

import { useRouter } from 'next/navigation'
import { useState, type ChangeEvent, type FormEvent } from 'react'

interface Props {
  ticketId:        number
  currentScheduled: string | null
  onClose:         (committed: boolean) => void
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SchedulingModal({ ticketId, currentScheduled, onClose }: Props) {
  const router = useRouter()
  const [scheduled,  setScheduled]  = useState(toLocalInputValue(currentScheduled))
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const body = {
        scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
      }
      const res = await fetch(`/api/admin/work-orders/${ticketId}/details`, {
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
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={() => !submitting && onClose(false)}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Set Scheduled date</h2>
          <button
            onClick={() => !submitting && onClose(false)}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >×</button>
        </div>

        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <label className="block">
              <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Scheduled date</span>
              <input
                type="datetime-local"
                value={scheduled}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setScheduled(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Maps to CINC's IssuedDate. Saving pushes the new date to CINC if this WO is synced.
                Auto-bumps when the work is actually completed later.
              </p>
            </label>

            {error && <div className="text-xs text-red-600">{error}</div>}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg shrink-0">
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
            >Cancel</button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-[#f26a1b] text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14] disabled:opacity-50"
            >{submitting ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
