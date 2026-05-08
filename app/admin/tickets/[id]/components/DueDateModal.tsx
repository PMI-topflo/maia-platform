// =====================================================================
// app/admin/tickets/[id]/components/DueDateModal.tsx
// Modal for staff to push a ticket's due date with a recorded reason.
// Reasons are grouped by category in the dropdown; each carries a
// 'controllable' / 'non-controllable' bucket the API resolves
// server-side for KPI reporting.
// =====================================================================

'use client'

import { useRouter } from 'next/navigation'
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { DELAY_REASONS } from '@/lib/ticket-delay-reasons'

interface Props {
  ticketId:    number
  currentDue:  string | null
  onClose:     () => void
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  // <input type="datetime-local"> needs local YYYY-MM-DDTHH:MM
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function DueDateModal({ ticketId, currentDue, onClose }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const [newDue,     setNewDue]     = useState(toLocalInputValue(currentDue))
  const [reasonCode, setReasonCode] = useState('')
  const [note,       setNote]       = useState('')

  // Group reasons by category for the dropdown <optgroup>s.
  const groups: Record<string, typeof DELAY_REASONS> = {}
  for (const r of DELAY_REASONS) {
    if (!groups[r.category]) groups[r.category] = []
    groups[r.category].push(r)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!newDue || !reasonCode) {
      setError('Date and reason are required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/due-date`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          new_due_at:  new Date(newDue).toISOString(),
          reason_code: reasonCode,
          note:        note.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-20 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Change due date</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <Field label="New due date *">
            <input
              type="datetime-local"
              value={newDue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewDue(e.target.value)}
              required
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
            />
          </Field>

          <Field label="Reason *">
            <select
              value={reasonCode}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setReasonCode(e.target.value)}
              required
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
            >
              <option value="">— pick a reason —</option>
              {Object.entries(groups).map(([category, reasons]) => (
                <optgroup key={category} label={category}>
                  {reasons.map(r => (
                    <option key={r.code} value={r.code}>
                      {r.label}{r.bucket === 'internal' ? ' (internal)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              Internal reasons count toward team-efficiency KPIs. External reasons (vendors, owners, banks) don't.
            </p>
          </Field>

          <Field label="Note (optional)">
            <textarea
              value={note}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
              rows={3}
              placeholder="Context for the delay (vendor name, ETA, ticket dependency, etc.)"
              className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-[#f26a1b]"
            />
          </Field>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !newDue || !reasonCode}
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
