'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { AssociationOption } from './TicketDetailClient'

interface Props {
  ticketId:        number
  associations:    AssociationOption[]
  initial: {
    association_code: string | null
    unit_number:      string | null
    is_board_request: boolean
  }
  onClose: () => void
}

/** Edit the ticket's Association / Unit / Board-request flag. Issues a
 *  PATCH that only includes fields the user actually changed so the
 *  ticket_events timeline doesn't fill up with no-op rows. */
export default function EditDetailsModal({ ticketId, associations, initial, onClose }: Props) {
  const router = useRouter()
  const [assoc, setAssoc]               = useState<string>(initial.association_code ?? '')
  const [unit, setUnit]                 = useState<string>(initial.unit_number ?? '')
  const [isBoardRequest, setIsBoardReq] = useState<boolean>(initial.is_board_request)
  const [busy, setBusy]                 = useState(false)
  const [err,  setErr]                  = useState<string | null>(null)

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    const trimmedUnit = unit.trim()
    const patch: Record<string, unknown> = {}
    const initialAssoc = initial.association_code ?? ''
    const initialUnit  = initial.unit_number ?? ''
    if (assoc !== initialAssoc)              patch.association_code = assoc || null
    if (trimmedUnit !== initialUnit)         patch.unit_number      = trimmedUnit || null
    if (isBoardRequest !== initial.is_board_request) patch.is_board_request = isBoardRequest
    if (Object.keys(patch).length === 0) { onClose(); return }

    setBusy(true)
    setErr(null)
    try {
      const res  = await fetch(`/api/admin/tickets/${ticketId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      router.refresh()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Edit ticket details</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">Association</span>
            <select
              value={assoc}
              onChange={e => setAssoc(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#f26a1b] focus:outline-none"
            >
              <option value="">— None —</option>
              {associations.map(a => (
                <option key={a.association_code} value={a.association_code}>
                  {a.association_name} ({a.association_code})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">Unit number</span>
            <input
              type="text"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              placeholder="e.g. 305, PH-2, Townhouse 14"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#f26a1b] focus:outline-none"
            />
          </label>

          <label className="flex cursor-pointer items-start gap-2 pt-1">
            <input
              type="checkbox"
              checked={isBoardRequest}
              onChange={e => setIsBoardReq(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#f26a1b]"
            />
            <span className="text-sm text-gray-700">
              <span className="font-medium">This is a board request</span>
              <span className="block text-[11px] text-gray-500">
                Tag tickets that originated from a board member, not an owner or tenant.
              </span>
            </span>
          </label>

          {err && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded bg-[#f26a1b] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#d85a14] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
