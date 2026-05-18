// =====================================================================
// app/admin/communications/components/TicketPickerModal.tsx
//
// Searchable ticket picker. Used by the communications dashboard to
// link an email or conversation to a ticket / work order. Generic
// enough to reuse elsewhere (e.g. WO bulk-link in future PRs).
// =====================================================================

'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

interface TicketHit {
  id:                number
  ticket_number:     string
  subject:           string | null
  type:              string
  status:            string
  association_code:  string | null
  updated_at:        string
}

interface Props {
  title?:    string
  onClose:   (linkedTicketId?: number) => void
  /** Async function the caller provides to perform the actual link.
   *  Receives the chosen ticket id; should throw on failure. */
  onConfirm: (ticketId: number) => Promise<void>
}

export default function TicketPickerModal({ title = 'Link to ticket', onClose, onConfirm }: Props) {
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState<TicketHit[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [selected,   setSelected]   = useState<TicketHit | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fetchResults = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tickets/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setResults(data.tickets ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load (recent tickets) + debounced re-query when typing.
  useEffect(() => {
    const handle = setTimeout(() => { void fetchResults(query) }, 250)
    return () => clearTimeout(handle)
  }, [query, fetchResults])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(selected.id)
      onClose(selected.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={() => !submitting && onClose()}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >×</button>
        </div>

        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 space-y-3 overflow-y-auto flex-1">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by ticket number or subject…"
              autoFocus
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
            />

            {loading && <div className="text-xs text-gray-400">Searching…</div>}
            {error && <div className="text-xs text-red-600">{error}</div>}

            {!loading && results.length === 0 && (
              <div className="text-xs text-gray-400 italic px-2 py-3">
                No matching tickets. Try a different search.
              </div>
            )}

            {results.length > 0 && (
              <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-80 overflow-y-auto">
                {results.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelected(t)}
                    className={[
                      'w-full text-left px-3 py-2 text-sm hover:bg-gray-50',
                      selected?.id === t.id ? 'bg-blue-50' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#f26a1b]">{t.ticket_number}</span>
                      <span className={[
                        'inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium uppercase',
                        t.type === 'work_order' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700',
                      ].join(' ')}>
                        {t.type === 'work_order' ? 'WO' : 'Ticket'}
                      </span>
                      <span className="text-[10px] text-gray-500 uppercase">{t.status.replace('_', ' ')}</span>
                      {t.association_code && (
                        <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px]">{t.association_code}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-gray-800 line-clamp-1">{t.subject ?? '—'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg shrink-0">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
            >Cancel</button>
            <button
              type="submit"
              disabled={submitting || !selected}
              className="bg-[#f26a1b] text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14] disabled:opacity-50"
            >
              {submitting ? 'Linking…' : selected ? `Link to ${selected.ticket_number}` : 'Pick a ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
