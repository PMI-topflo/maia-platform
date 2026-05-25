// =====================================================================
// app/admin/communications/components/TicketPickerModal.tsx
//
// Searchable ticket picker. Used by the communications dashboard to
// link an email or conversation to a ticket / work order. Generic
// enough to reuse elsewhere (e.g. WO bulk-link in future PRs).
// =====================================================================

'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { TICKET_CATEGORIES } from '@/lib/ticket-categories'

interface TicketHit {
  id:                number
  ticket_number:     string
  subject:           string | null
  type:              string
  status:            string
  association_code:  string | null
  updated_at:        string
}

interface AssociationOption {
  association_code: string
  association_name: string
}

interface Props {
  title?:    string
  onClose:   (linkedTicketId?: number) => void
  /** Async function the caller provides to perform the actual link.
   *  Receives the chosen ticket id; should throw on failure. */
  onConfirm: (ticketId: number) => Promise<void>
  /** Optional pre-fill for the create-new fields when the caller has
   *  context — e.g. linking from an email, prefill subject + contact. */
  initialCreate?: {
    subject?:          string
    contact_name?:     string | null
    contact_email?:    string | null
    association_code?: string | null
  }
}

export default function TicketPickerModal({
  title = 'Link to ticket',
  onClose,
  onConfirm,
  initialCreate,
}: Props) {
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState<TicketHit[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [selected,   setSelected]   = useState<TicketHit | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Create-new path — for when no existing ticket / work order fits.
  const [showCreate,       setShowCreate]       = useState(false)
  const [newType,          setNewType]          = useState<'ticket' | 'work_order'>('ticket')
  const [newSubject,       setNewSubject]       = useState(initialCreate?.subject ?? '')
  const [newAssoc,         setNewAssoc]         = useState<string>(initialCreate?.association_code ?? '')
  const [newCategory,      setNewCategory]      = useState<string>('')
  const [newUnit,          setNewUnit]          = useState<string>('')
  const [newRequestedBy,   setNewRequestedBy]   = useState<string>('')
  const [newIsBoardReq,    setNewIsBoardReq]    = useState<boolean>(false)
  const [associations,     setAssociations]     = useState<AssociationOption[]>([])
  const [assocLoading,     setAssocLoading]     = useState(false)

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

  // Lazy-fetch associations the first time the create-new section opens.
  // Stays cached in state across show/hide toggles within the same modal.
  useEffect(() => {
    if (!showCreate || associations.length > 0 || assocLoading) return
    setAssocLoading(true)
    fetch('/api/associations', { cache: 'no-store' })
      .then(r => r.json())
      .then((rows: unknown) => {
        if (Array.isArray(rows)) {
          setAssociations(rows.filter((r): r is AssociationOption =>
            !!r && typeof (r as AssociationOption).association_code === 'string'
                && typeof (r as AssociationOption).association_name === 'string',
          ))
        }
      })
      .catch(() => { /* dropdown just stays empty; not worth surfacing */ })
      .finally(() => setAssocLoading(false))
  }, [showCreate, associations.length, assocLoading])

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

  /** Create a brand-new ticket / work order, then link to it. */
  async function createAndLink() {
    if (!newSubject.trim()) { setError('Enter a subject for the new item.'); return }
    setSubmitting(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        type:             newType,
        subject:          newSubject.trim(),
        channel_origin:   'internal',
        association_code: newAssoc || null,
        unit_number:      newUnit.trim() || null,
        requested_by:     newRequestedBy.trim() || null,
        is_board_request: newIsBoardReq,
        // Pre-fill the contact fields from the linking context (the email
        // we're attaching this ticket to) so the new ticket already
        // points back at the sender.
        contact_name:     initialCreate?.contact_name  ?? null,
        contact_email:    initialCreate?.contact_email ?? null,
      }
      if (newType === 'ticket' && newCategory) body.ticket_category = newCategory
      const res = await fetch('/api/admin/tickets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not create the item')
      const newId = data.ticket?.id as number
      if (!newId) throw new Error('Create succeeded but no id was returned')
      await onConfirm(newId)
      onClose(newId)
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
        className={[
          'bg-white rounded-lg shadow-xl w-full flex flex-col max-h-[90vh]',
          // Widen when the create-new form is open so the extra fields
          // have room to breathe.
          showCreate ? 'max-w-2xl' : 'max-w-lg',
        ].join(' ')}
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
              <div className="text-xs text-gray-400 italic px-2 py-2">
                No matching tickets. Search again, or create a new one below.
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

            {/* Create-new path — when nothing existing fits. */}
            <div className="border-t border-gray-100 pt-3">
              {!showCreate ? (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]"
                >
                  + Create a new ticket or work order instead
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">New ticket / work order</div>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={newType === 'ticket'} onChange={() => setNewType('ticket')} className="accent-[#f26a1b]" />
                      Ticket
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={newType === 'work_order'} onChange={() => setNewType('work_order')} className="accent-[#f26a1b]" />
                      Work order
                    </label>
                  </div>
                  <input
                    type="text"
                    value={newSubject}
                    onChange={e => setNewSubject(e.target.value)}
                    placeholder="Subject for the new item…"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">Association</span>
                      <select
                        value={newAssoc}
                        onChange={e => setNewAssoc(e.target.value)}
                        disabled={assocLoading}
                        className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
                      >
                        <option value="">{assocLoading ? 'Loading…' : '— None —'}</option>
                        {associations.map(a => (
                          <option key={a.association_code} value={a.association_code}>
                            {a.association_name} ({a.association_code})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">Unit number</span>
                      <input
                        type="text"
                        value={newUnit}
                        onChange={e => setNewUnit(e.target.value)}
                        placeholder="e.g. 305, PH-2"
                        className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
                      />
                    </label>

                    {newType === 'ticket' && (
                      <label className="block col-span-2">
                        <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">Category</span>
                        <select
                          value={newCategory}
                          onChange={e => setNewCategory(e.target.value)}
                          className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
                        >
                          <option value="">— Uncategorised</option>
                          {TICKET_CATEGORIES.map(c => (
                            <option key={c.label} value={c.label}>{c.label} — {c.hint}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="block col-span-2">
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">Requested by</span>
                      <input
                        type="text"
                        value={newRequestedBy}
                        onChange={e => setNewRequestedBy(e.target.value)}
                        placeholder="Owner / board member / staff who asked"
                        className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
                      />
                    </label>
                  </div>

                  <label className="flex cursor-pointer items-start gap-2 pt-1">
                    <input
                      type="checkbox"
                      checked={newIsBoardReq}
                      onChange={e => setNewIsBoardReq(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#f26a1b]"
                    />
                    <span className="text-sm text-gray-700">
                      This is a board request
                      <span className="block text-[10px] text-gray-500">Tag tickets that originated from a board member.</span>
                    </span>
                  </label>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void createAndLink()}
                      disabled={submitting || !newSubject.trim()}
                      className="bg-[#f26a1b] text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14] disabled:opacity-50"
                    >
                      {submitting ? 'Creating…' : `Create & link ${newType === 'work_order' ? 'work order' : 'ticket'}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreate(false)
                        setNewSubject('')
                        setNewCategory('')
                        setNewUnit('')
                        setNewRequestedBy('')
                        setNewIsBoardReq(false)
                      }}
                      className="text-xs text-gray-500 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
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
