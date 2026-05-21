// =====================================================================
// app/admin/tickets/[id]/components/RelatedTicketsCard.tsx
//
// "Related tickets & work orders" panel on the ticket detail page.
// Links one ticket to another ticket or work order (work orders are
// tickets too). Reuses the shared TicketPickerModal, which also offers
// a "create new" path.
// =====================================================================

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

import TicketPickerModal from '@/app/admin/communications/components/TicketPickerModal'

interface RelatedTicket {
  id:               number
  ticket_number:    string
  type:             string
  status:           string | null
  subject:          string | null
  association_code: string | null
}

export default function RelatedTicketsCard({ ticketId }: { ticketId: number }) {
  const [links,      setLinks]      = useState<RelatedTicket[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [busyUnlink, setBusyUnlink] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/admin/tickets/${ticketId}/links`, { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) setLinks(data.links ?? [])
    } catch {
      /* the panel just shows empty on failure */
    } finally {
      setLoading(false)
    }
  }, [ticketId])

  useEffect(() => { void load() }, [load])

  async function addLink(relatedId: number) {
    const res  = await fetch(`/api/admin/tickets/${ticketId}/links`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ related_ticket_id: relatedId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error ?? 'Could not link')
    setLinks(data.links ?? [])
  }

  async function unlink(relatedId: number) {
    setBusyUnlink(relatedId)
    try {
      const res  = await fetch(`/api/admin/tickets/${ticketId}/links?related_ticket_id=${relatedId}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) setLinks(data.links ?? [])
    } finally {
      setBusyUnlink(null)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900">Related tickets &amp; work orders</h3>
        <button
          onClick={() => setShowPicker(true)}
          className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]"
        >
          + Link
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-gray-400">Loading…</div>
      ) : links.length === 0 ? (
        <div className="text-xs text-gray-400 italic">Nothing linked yet.</div>
      ) : (
        <div className="space-y-1.5">
          {links.map(l => (
            <div key={l.id} className="flex items-center gap-2 text-xs">
              <Link href={`/admin/tickets/${l.id}`} className="font-mono text-[#f26a1b] hover:underline shrink-0">
                {l.ticket_number}
              </Link>
              <span className={[
                'inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium uppercase shrink-0',
                l.type === 'work_order' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700',
              ].join(' ')}>
                {l.type === 'work_order' ? 'WO' : 'Ticket'}
              </span>
              <span className="text-gray-700 line-clamp-1 flex-1">{l.subject ?? '—'}</span>
              <button
                onClick={() => void unlink(l.id)}
                disabled={busyUnlink === l.id}
                title="Unlink"
                className="text-gray-400 hover:text-red-600 px-1 disabled:opacity-40 shrink-0"
              >
                {busyUnlink === l.id ? '…' : '×'}
              </button>
            </div>
          ))}
        </div>
      )}

      {showPicker && (
        <TicketPickerModal
          title="Link a ticket or work order"
          onClose={() => setShowPicker(false)}
          onConfirm={async (id) => { await addLink(id) }}
        />
      )}
    </div>
  )
}
