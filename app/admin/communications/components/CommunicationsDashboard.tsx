'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import TicketPickerModal from './TicketPickerModal'

/** Extract bare lowercase email addresses from a raw header value that
 *  may be "Name <addr>", "<addr>", or a comma/semicolon-separated list
 *  of recipients. Used so the From/To filters match regardless of how
 *  the address was stored (bracket-wrapped, with display name, etc.). */
function extractEmailAddrs(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,;]/)
    .map(part => {
      const m = part.match(/<([^>]+)>/)
      return (m ? m[1] : part).trim().toLowerCase()
    })
    .filter(a => a.includes('@'))
}

// Shape returned by GET /api/admin/communications/links keyed by communication id.
interface LinkedTicket {
  id:               number  // link row id (used for DELETE)
  ticket_id:        number
  ticket_number:    string
  subject:          string | null
  type:             string
  status:           string
  linked_at:        string
  linked_by_email:  string | null
}

/** Link a communication (email/conversation) to a ticket, then return
 *  the freshly-created LinkedTicket row. The POST returns only a partial,
 *  so we re-query the full row. Throws on failure (the picker shows it). */
async function createTicketLink(
  communicationType: 'conversation' | 'email',
  communicationId:   string,
  ticketId:          number,
): Promise<LinkedTicket | null> {
  const res = await fetch('/api/admin/communications/links', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      communication_type: communicationType,
      communication_id:   communicationId,
      ticket_id:          ticketId,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? 'Link failed')
  const full = await fetch(
    `/api/admin/communications/links?type=${communicationType}&ids=${encodeURIComponent(communicationId)}`,
    { cache: 'no-store' },
  ).then(r => r.json())
  const fetched = (full?.links?.[communicationId] ?? []) as LinkedTicket[]
  return fetched.find(l => l.ticket_id === ticketId) ?? null
}

/** Shared inline UI for the expanded preview: linked tickets list +
 *  link button + unlink. Caller manages its own links state to share
 *  the fetch across rows. */
function LinkedTicketsPanel({
  links,
  communicationType,
  communicationId,
  onLinked,
  onUnlinked,
}: {
  links:             LinkedTicket[]
  communicationType: 'conversation' | 'email'
  communicationId:   string
  onLinked:          (link: LinkedTicket) => void
  onUnlinked:        (linkId: number) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [busyUnlink, setBusyUnlink] = useState<number | null>(null)

  async function unlink(linkId: number) {
    setBusyUnlink(linkId)
    try {
      const res = await fetch(`/api/admin/communications/links?id=${linkId}`, { method: 'DELETE' })
      if (res.ok) onUnlinked(linkId)
    } finally {
      setBusyUnlink(null)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between mb-1">
        <div className="text-gray-400 font-semibold text-xs">Linked tickets / work orders</div>
        <button
          onClick={() => setShowPicker(true)}
          className="text-xs text-[#f26a1b] hover:text-[#d85a14]"
        >
          + Link to ticket
        </button>
      </div>
      {links.length === 0 ? (
        <div className="text-xs text-gray-300 italic">None yet.</div>
      ) : (
        <div className="space-y-1">
          {links.map(l => (
            <div key={l.id} className="flex items-center gap-2 text-xs">
              <a
                href={`/admin/tickets/${l.ticket_id}`}
                className="font-mono text-[#f26a1b] hover:underline"
              >
                {l.ticket_number}
              </a>
              <span className={[
                'inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium uppercase',
                l.type === 'work_order' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700',
              ].join(' ')}>
                {l.type === 'work_order' ? 'WO' : 'Ticket'}
              </span>
              <span className="text-gray-700 line-clamp-1 flex-1">{l.subject ?? '—'}</span>
              <button
                onClick={() => void unlink(l.id)}
                disabled={busyUnlink === l.id}
                title="Unlink"
                className="text-gray-400 hover:text-red-600 px-1 disabled:opacity-40"
              >
                {busyUnlink === l.id ? '…' : '×'}
              </button>
            </div>
          ))}
        </div>
      )}

      {showPicker && (
        <TicketPickerModal
          title="Link to ticket or work order"
          onClose={() => setShowPicker(false)}
          onConfirm={async (ticketId) => {
            const fresh = await createTicketLink(communicationType, communicationId, ticketId)
            if (fresh) onLinked(fresh)
          }}
        />
      )}
    </div>
  )
}

/** Bulk-fetch linked tickets for a list of communication ids. Returns
 *  a stateful map indexed by communication id + helpers to mutate it
 *  in place when a link/unlink happens. */
function useCommunicationLinks(type: 'conversation' | 'email', ids: string[]) {
  const [linksById, setLinksById] = useState<Record<string, LinkedTicket[]>>({})
  const idsKey = ids.slice().sort().join(',')

  useEffect(() => {
    if (ids.length === 0) { setLinksById({}); return }
    let cancelled = false
    fetch(`/api/admin/communications/links?type=${type}&ids=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!cancelled) setLinksById(d.links ?? {}) })
      .catch(() => { /* swallow; the inline UI degrades gracefully */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, idsKey])

  function pushLink(commId: string, link: LinkedTicket) {
    setLinksById(prev => ({ ...prev, [commId]: [...(prev[commId] ?? []), link] }))
  }
  function dropLink(commId: string, linkId: number) {
    setLinksById(prev => ({ ...prev, [commId]: (prev[commId] ?? []).filter(l => l.id !== linkId) }))
  }
  return { linksById, pushLink, dropLink }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string
  session_id: string | null
  persona: string | null
  language: string | null
  association_code: string | null
  topic: string | null
  status: string | null
  channel: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  assigned_to: string | null
  handled_by: string | null
  summary: string | null
  message: string | null
  response: string | null
  subject: string | null
  sender_email: string | null
  created_at: string
  updated_at: string
  messages: Array<{ role: string; content: string }> | null
}

interface EmailLog {
  id: string
  direction: string | null
  from_email: string | null
  to_email: string | null
  subject: string | null
  body_preview: string | null
  persona: string | null
  association_code: string | null
  status: string | null
  resend_message_id: string | null
  sent_by: string | null
  created_at: string
  dismissed_at?:        string | null
  dismissed_by_email?:  string | null
  gmail_thread_id?:     string | null
}

interface Ticket {
  id: string | number
  title: string | null
  subject: string | null
  description: string | null
  type: string | null
  ticket_type: string | null
  status: string | null
  priority: string | null
  association_code: string | null
  channel_source: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  persona: string | null
  assigned_to: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
}

interface Staff {
  id: string
  name: string
  email: string | null
  role: string | null
  department: string | null
  /** Every address known for this staff member (login email + business /
   *  personal email + alt_emails), lowercased. Drives the "All staff"
   *  email filter so it matches inbound mail to the person's inbox. */
  emails?: string[]
}

interface EmailCommand {
  id: string
  sender_email: string
  sender_name: string | null
  subject: string | null
  trigger_phrase: string | null
  record_type: string | null
  extracted_data: Record<string, unknown> | null
  status: string
  error_message: string | null
  db_record_id: string | null
  db_table: string | null
  reply_sent: boolean | null
  attachments: Array<{ filename: string; url: string | null }> | null
  reference_code: string | null
  created_at: string
  updated_at: string
}

interface Props {
  conversations: Conversation[]
  emails: EmailLog[]
  tickets: Ticket[]
  staff: Staff[]
  emailCommands: EmailCommand[]
  canSeeAll?:    boolean   // true when the viewer has global access; false = filtered to their own
  showDismissed?: boolean  // URL flag — when true, dismissed rows are included
  // Comprehensive dropdown options (computed server-side from the
  // last 10 days, not just rows currently loaded in the table).
  emailFromOptions?:          string[]
  emailToOptions?:            string[]
  conversationSenderOptions?: string[]
  // Active server-side email filters (mirrored from the URL). When set,
  // the email list is already filtered by the server — the dropdowns
  // just reflect/drive these.
  emailTo?:   string
  emailFrom?: string
  // URL flag — when true, archived conversations are included.
  showConvArchived?: boolean
  // True count of emails matching the active server filter — may
  // exceed the 1000 rows actually loaded into the table.
  emailTotal?: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function channelIcon(channel: string | null) {
  if (channel === 'whatsapp') return '💬'
  if (channel === 'sms')      return '📱'
  if (channel === 'voice')    return '📞'
  if (channel === 'web')      return '🌐'
  return '💬'
}

function statusBadge(status: string | null) {
  const s = status ?? 'open'
  const map: Record<string, string> = {
    open:       'bg-amber-100 text-amber-800',
    processing: 'bg-blue-100 text-blue-800',
    resolved:   'bg-green-100 text-green-800',
    completed:  'bg-green-100 text-green-800',
    sent:       'bg-green-100 text-green-800',
    escalated:  'bg-red-100 text-red-800',
    failed:     'bg-red-100 text-red-800',
    closed:     'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${map[s] ?? map.open}`}>
      {s}
    </span>
  )
}

function emailStatusBadge(status: string | null) {
  const s = status ?? 'sent'
  const map: Record<string, string> = {
    sent:      'bg-blue-100 text-blue-800',
    delivered: 'bg-green-100 text-green-800',
    opened:    'bg-indigo-100 text-indigo-800',
    clicked:   'bg-purple-100 text-purple-800',
    bounced:   'bg-red-100 text-red-800',
    complained:'bg-orange-100 text-orange-800',
    delayed:   'bg-yellow-100 text-yellow-800',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${map[s] ?? map.sent}`}>
      {s}
    </span>
  )
}

function priorityBadge(priority: string | null) {
  const p = priority ?? 'normal'
  const map: Record<string, string> = {
    urgent: 'bg-red-100 text-red-800',
    high:   'bg-orange-100 text-orange-800',
    normal: 'bg-gray-100 text-gray-600',
    low:    'bg-slate-100 text-slate-500',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${map[p] ?? map.normal}`}>
      {p}
    </span>
  )
}

// ── Tab: Conversations ───────────────────────────────────────────────────────

function ConversationsTab({
  conversations,
  staff,
  senderOptionsOverride = [],
  showArchived = false,
}: {
  conversations:          Conversation[]
  staff:                  Staff[]
  senderOptionsOverride?: string[]
  showArchived?:          boolean
}) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterChannel, setFilterChannel] = useState('all')
  const [filterAssignedTo, setFilterAssignedTo] = useState('all')
  const [filterFrom, setFilterFrom] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [archiving, setArchiving] = useState(false)

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else              next.add(id)
      return next
    })
  }

  function toggleArchivedView() {
    const params = new URLSearchParams(searchParams.toString())
    if (showArchived) params.delete('convArchived')
    else              params.set('convArchived', '1')
    const qs = params.toString()
    router.push(qs ? `?${qs}` : '?')
  }

  async function archiveConversations(ids: string[], action: 'archive' | 'restore') {
    if (ids.length === 0 || archiving) return
    setArchiving(true)
    try {
      const res = await fetch('/api/admin/communications/archive-conversations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids, action }),
      })
      if (!res.ok) {
        alert((await res.json())?.error ?? `${action} failed`)
        return
      }
      setSelected(new Set())
      router.refresh()
    } catch {
      alert('Network error — please try again.')
    } finally {
      setArchiving(false)
    }
  }

  // Prefer server-computed options (covers ALL last-10-day data, not
  // just the rows currently loaded). Fall back to in-prop dedupe so
  // the component still renders if a caller didn't pass an override.
  const senderOptions = senderOptionsOverride.length > 0
    ? senderOptionsOverride
    : Array.from(new Set(
        conversations.map(c => (c.sender_email ?? c.contact_email ?? '').toLowerCase()).filter(Boolean),
      )).sort()

  const filtered = conversations.filter(c => {
    if (filterStatus !== 'all' && (c.status ?? 'open') !== filterStatus) return false
    if (filterChannel !== 'all' && c.channel !== filterChannel) return false
    if (filterAssignedTo !== 'all') {
      if (filterAssignedTo === '__unassigned' ? c.assigned_to : c.assigned_to !== filterAssignedTo) return false
    }
    if (filterFrom !== 'all') {
      const sender = (c.sender_email ?? c.contact_email ?? '').toLowerCase()
      if (sender !== filterFrom) return false
    }
    if (search) {
      const q = search.toLowerCase()
      return (
        c.contact_name?.toLowerCase().includes(q) ||
        c.contact_phone?.includes(q) ||
        c.contact_email?.toLowerCase().includes(q) ||
        c.association_code?.toLowerCase().includes(q) ||
        c.summary?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const staffById = Object.fromEntries(staff.map(s => [s.id, s.name]))
  const { linksById, pushLink, dropLink } = useCommunicationLinks(
    'conversation',
    filtered.map(c => c.id),
  )

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search name, phone, email, association…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#f26a1b]"
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="all">All channels</option>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="voice">Voice</option>
          <option value="web">Web chat</option>
        </select>
        <select
          value={filterAssignedTo}
          onChange={e => setFilterAssignedTo(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1.5 text-sm"
        >
          <option value="all">All assignees</option>
          <option value="__unassigned">— Unassigned</option>
          {staff.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {senderOptions.length > 0 && (
          <select
            value={filterFrom}
            onChange={e => setFilterFrom(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-sm max-w-[200px]"
            title="Filter by sender email"
          >
            <option value="all">All senders</option>
            {senderOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={toggleArchivedView}
          className={[
            'inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border transition-colors',
            showArchived
              ? 'bg-amber-100 text-amber-900 border-amber-300'
              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400',
          ].join(' ')}
          title="Toggle visibility of archived conversations"
        >
          {showArchived ? '✓ Show archived' : 'Show archived'}
        </button>
      </div>

      {/* Bulk action bar — appears once rows are selected. */}
      <div className="flex items-center justify-between mb-2 min-h-[28px]">
        <div className="text-xs text-gray-400">
          {filtered.length} conversation{filtered.length === 1 ? '' : 's'}
          {showArchived && <span className="text-amber-700"> · archived</span>}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{selected.size} selected</span>
            <button
              type="button"
              onClick={() => archiveConversations([...selected], showArchived ? 'restore' : 'archive')}
              disabled={archiving}
              className="text-xs px-2.5 py-1 rounded bg-[#f26a1b] text-white font-medium hover:bg-[#d85a14] disabled:opacity-50"
            >
              {archiving
                ? 'Working…'
                : showArchived
                  ? `Restore ${selected.size}`
                  : `Archive ${selected.size}`}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Clear
            </button>
          </div>
        )}
        {selected.size === 0 && filtered.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set(filtered.map(c => c.id)))}
            className="text-xs text-gray-500 hover:text-[#f26a1b]"
          >
            Select all
          </button>
        )}
      </div>

      <div className="space-y-2">
        {filtered.map(c => (
          <div key={c.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-stretch">
              <label className="flex items-center pl-3 pr-1">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleSelect(c.id)}
                  className="w-4 h-4 accent-[#f26a1b] cursor-pointer"
                />
              </label>
              <button
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                className="flex-1 min-w-0 text-left px-3 py-3 hover:bg-gray-50 transition-colors"
              >
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5">{channelIcon(c.channel)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900">
                      {c.contact_name ?? c.contact_phone ?? c.session_id?.slice(0, 12) ?? '—'}
                    </span>
                    {c.contact_phone && <span className="text-xs text-gray-400">{c.contact_phone}</span>}
                    {statusBadge(c.status)}
                    {c.persona && (
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] uppercase">
                        {c.persona.replace(/_/g, ' ')}
                      </span>
                    )}
                    {c.association_code && (
                      <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px]">{c.association_code}</span>
                    )}
                  </div>
                  <p className="text-xs mt-1 truncate">
                    {(() => {
                      const msg = c.message?.trim()
                      const res = c.response?.trim()
                      const ch  = c.channel
                      let preview: string | null = null

                      if (ch === 'whatsapp' || ch === 'sms') {
                        const inPart  = msg ? `IN: ${msg.slice(0, 80)}`  : null
                        const outPart = res ? `OUT: ${res.slice(0, 80)}` : null
                        preview = [inPart, outPart].filter(Boolean).join(' | ') || null
                      } else if (ch === 'email') {
                        const subj = c.subject ? `Subject: ${c.subject}` : null
                        const body = msg ? msg.slice(0, 80) : null
                        preview = [subj, body].filter(Boolean).join(' | ') || null
                      } else {
                        preview =
                          msg?.slice(0, 100) ||
                          c.summary?.trim()  ||
                          c.messages?.find(m => m.role === 'user')?.content?.trim()?.slice(0, 100) ||
                          null
                      }

                      return preview
                        ? <span className="text-gray-500">{preview}</span>
                        : <span className="text-gray-300 italic">No message content available</span>
                    })()}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-gray-400">{fmtDate(c.updated_at)}</div>
                  {c.assigned_to && (
                    <div className="text-xs text-[#f26a1b] mt-0.5">→ {staffById[c.assigned_to] ?? c.assigned_to.slice(0, 8)}</div>
                  )}
                </div>
              </div>
              </button>
              <button
                type="button"
                onClick={() => archiveConversations([c.id], showArchived ? 'restore' : 'archive')}
                disabled={archiving}
                className="px-3 text-gray-300 hover:text-[#f26a1b] hover:bg-gray-50 transition-colors disabled:opacity-40"
                title={showArchived ? 'Restore conversation' : 'Archive conversation'}
              >
                {showArchived ? '↺' : '✕'}
              </button>
            </div>

            {expanded === c.id && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                  <div><span className="text-gray-400">Phone:</span> {c.contact_phone ?? '—'}</div>
                  <div><span className="text-gray-400">Email:</span> {c.contact_email ?? '—'}</div>
                  <div><span className="text-gray-400">Language:</span> {c.language ?? 'en'}</div>
                  <div><span className="text-gray-400">Channel:</span> {c.channel ?? '—'}</div>
                  <div><span className="text-gray-400">Assigned:</span> {c.assigned_to ? (staffById[c.assigned_to] ?? c.assigned_to.slice(0, 8)) : '—'}</div>
                  <div><span className="text-gray-400">Handled by:</span> {c.handled_by ? (staffById[c.handled_by] ?? c.handled_by) : 'maia (ai)'}</div>
                  <div><span className="text-gray-400">Created:</span> {fmtDate(c.created_at)}</div>
                  <div><span className="text-gray-400">ID:</span> <span className="font-mono">{c.id.slice(0, 12)}…</span></div>
                </div>

                {(c.channel === 'email' || c.channel === 'whatsapp' || c.channel === 'sms') && (
                  <div className="space-y-2 mt-3 pt-3 border-t border-gray-100 text-xs">
                    <div>
                      <div className="text-gray-400 font-semibold mb-1">Message</div>
                      {c.message?.trim()
                        ? <div className="bg-white border border-gray-100 rounded px-3 py-2 text-gray-700 whitespace-pre-wrap max-h-32 overflow-y-auto">{c.message}</div>
                        : <div className="text-gray-300 italic">No message content available</div>
                      }
                    </div>
                    <div>
                      <div className="text-gray-400 font-semibold mb-1">Response</div>
                      {c.response?.trim()
                        ? <div className="bg-white border border-gray-100 rounded px-3 py-2 text-gray-700 whitespace-pre-wrap max-h-32 overflow-y-auto">{c.response}</div>
                        : <div className="text-gray-300 italic">No response recorded</div>
                      }
                    </div>
                  </div>
                )}

                {c.messages && c.messages.length > 0 && (
                  <div className="max-h-64 overflow-y-auto space-y-1.5 mt-2">
                    {c.messages.slice(-10).map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${m.role === 'assistant' ? 'bg-white border border-gray-200 text-gray-700' : 'bg-[#f26a1b] text-white'}`}>
                          {m.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <LinkedTicketsPanel
                  links={linksById[c.id] ?? []}
                  communicationType="conversation"
                  communicationId={c.id}
                  onLinked={(link) => pushLink(c.id, link)}
                  onUnlinked={(linkId) => dropLink(c.id, linkId)}
                />
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No conversations match your filters.</div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Emails ──────────────────────────────────────────────────────────────

function EmailsTab({
  emails: emailsProp,
  staff,
  showDismissed,
  fromOptionsOverride = [],
  toOptionsOverride   = [],
  serverEmailTo       = '',
  serverEmailFrom     = '',
  emailTotal          = 0,
}: {
  emails:               EmailLog[]
  staff:                Staff[]
  showDismissed:        boolean
  fromOptionsOverride?: string[]
  toOptionsOverride?:   string[]
  serverEmailTo?:       string
  serverEmailFrom?:     string
  emailTotal?:          number
}) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  // The From/To filters run server-side (they search the whole 10-day
  // window, not just the loaded rows). Changing one navigates with a
  // new URL param; the server re-queries and returns the right set +
  // an accurate count. Other params (e.g. dismissed) are preserved.
  function setEmailFilterParam(key: 'emailTo' | 'emailFrom', value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === 'all') params.delete(key)
    else                          params.set(key, value)
    const qs = params.toString()
    router.push(qs ? `?${qs}` : '?')
  }

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSentBy, setFilterSentBy] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  // Local mirror so dismissing hides instantly (optimistic) and
  // restoring brings the row back without a page refresh.
  const [emails, setEmails] = useState<EmailLog[]>(emailsProp)
  // Keep in sync when the server returns a fresh batch (e.g. user
  // toggled "Show dismissed" which re-renders the page).
  useEffect(() => { setEmails(emailsProp) }, [emailsProp])

  const [busyDismissId, setBusyDismissId] = useState<string | null>(null)

  /** Dismiss a thread (or single message if no thread_id). Returns the
   *  set of email ids that ended up dismissed so the optimistic UI
   *  can hide them all at once. */
  async function dismissThread(threadKey: string, ids: string[], threadId: string | null) {
    setBusyDismissId(threadKey)
    try {
      const res = await fetch('/api/admin/communications/dismiss', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(
          threadId
            ? { type: 'email', thread_id: threadId }
            : { type: 'email', id: ids[0] },
        ),
      })
      if (res.ok) {
        const idSet = new Set(ids)
        if (showDismissed) {
          setEmails(prev => prev.map(e => idSet.has(e.id) ? { ...e, dismissed_at: new Date().toISOString() } : e))
        } else {
          setEmails(prev => prev.filter(e => !idSet.has(e.id)))
        }
      }
    } finally {
      setBusyDismissId(null)
    }
  }

  async function restoreThread(threadKey: string, ids: string[], threadId: string | null) {
    setBusyDismissId(threadKey)
    try {
      const qs = threadId
        ? `?type=email&thread_id=${encodeURIComponent(threadId)}`
        : `?type=email&id=${encodeURIComponent(ids[0])}`
      const res = await fetch(`/api/admin/communications/dismiss${qs}`, { method: 'DELETE' })
      if (res.ok) {
        const idSet = new Set(ids)
        setEmails(prev => prev.map(e => idSet.has(e.id) ? { ...e, dismissed_at: null, dismissed_by_email: null } : e))
      }
    } finally {
      setBusyDismissId(null)
    }
  }

  // Prefer server-computed options (covers ALL last-10-day data, not
  // just rows currently loaded). Fall back to in-prop dedupe.
  const toOptions = toOptionsOverride.length > 0
    ? toOptionsOverride
    : Array.from(new Set(
        emails.flatMap(e => extractEmailAddrs(e.to_email)),
      )).sort()
  const fromOptions = fromOptionsOverride.length > 0
    ? fromOptionsOverride
    : Array.from(new Set(
        emails.flatMap(e => extractEmailAddrs(e.from_email)),
      )).sort()

  // Note: From/To filtering happens server-side (see page.tsx) so it
  // searches the whole window, not just loaded rows. Only the instant
  // client-side filters (status, sentBy, search) run here.
  const filtered = emails.filter(e => {
    if (filterStatus !== 'all' && (e.status ?? 'sent') !== filterStatus) return false
    if (filterSentBy !== 'all') {
      if (filterSentBy === '__unknown') {
        if (e.sent_by) return false
      } else {
        // Treat the picked staff member as a mailbox: match an email if
        // ANY of from / to / sent_by hits one of that person's known
        // addresses. This covers inbound mail too — inbound rows store
        // the inbox address (or the literal "maia"), not the staff
        // identity, so a plain sent_by===id check missed them entirely.
        const staffRec = staff.find(s => s.id === filterSentBy)
        const addrs = new Set((staffRec?.emails ?? []).map(a => a.toLowerCase()))
        if (staffRec?.email) addrs.add(staffRec.email.toLowerCase())
        const sentBy = (e.sent_by ?? '').toLowerCase()
        const hit =
          e.sent_by === filterSentBy ||
          addrs.has(sentBy) ||
          extractEmailAddrs(e.from_email).some(a => addrs.has(a)) ||
          extractEmailAddrs(e.to_email).some(a => addrs.has(a))
        if (!hit) return false
      }
    }
    if (search) {
      const q = search.toLowerCase()
      return (
        e.from_email?.toLowerCase().includes(q) ||
        e.to_email?.toLowerCase().includes(q) ||
        e.subject?.toLowerCase().includes(q) ||
        e.persona?.toLowerCase().includes(q) ||
        e.association_code?.toLowerCase().includes(q)
      )
    }
    return true
  })

  // Group filtered emails into threads. gmail_thread_id is the key
  // when present; otherwise each row is its own "thread of 1".
  type EmailThread = {
    key:       string                   // gmail_thread_id OR `single-${id}`
    threadId:  string | null            // null when ungrouped (no gmail thread)
    latest:    EmailLog                 // most recent message — drives the row display
    count:     number
    messages:  EmailLog[]               // sorted oldest → newest
    ids:       string[]                 // all email_log ids in the thread
  }
  const threads: EmailThread[] = useMemo(() => {
    const map = new Map<string, EmailThread>()
    for (const e of filtered) {
      const tid = e.gmail_thread_id ?? null
      const key = tid ?? `single-${e.id}`
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { key, threadId: tid, latest: e, count: 1, messages: [e], ids: [e.id] })
      } else {
        existing.count++
        existing.messages.push(e)
        existing.ids.push(e.id)
        if (new Date(e.created_at).getTime() > new Date(existing.latest.created_at).getTime()) {
          existing.latest = e
        }
      }
    }
    for (const t of map.values()) {
      t.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return Array.from(map.values()).sort((a, b) =>
      new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime(),
    )
  }, [filtered])

  // Build the LinkedTicketsPanel against the LATEST message id of each
  // thread (preserves the existing ticket-link UX without bulk changes).
  const { linksById, pushLink, dropLink } = useCommunicationLinks(
    'email',
    threads.map(t => t.latest.id),
  )

  // Communication id whose ticket-link picker is open. Driven by the
  // per-row "+ Ticket" button so linking doesn't require expanding the
  // thread and scrolling past every message to reach the panel.
  const [linkPickerCommId, setLinkPickerCommId] = useState<string | null>(null)

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search sender, recipient, subject, association…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#f26a1b]"
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="all">All statuses</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered</option>
          <option value="opened">Opened</option>
          <option value="clicked">Clicked</option>
          <option value="bounced">Bounced</option>
          <option value="complained">Complained</option>
          <option value="delayed">Delayed</option>
        </select>
        <select
          value={filterSentBy}
          onChange={e => setFilterSentBy(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1.5 text-sm"
        >
          <option value="all">All staff</option>
          <option value="__unknown">— Unknown sender</option>
          {staff.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {toOptions.length > 0 && (
          <select
            value={serverEmailTo || 'all'}
            onChange={e => setEmailFilterParam('emailTo', e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-sm max-w-[200px]"
            title="Filter by recipient email (searches the whole 10-day window)"
          >
            <option value="all">All recipients</option>
            {toOptions.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        {fromOptions.length > 0 && (
          <select
            value={serverEmailFrom || 'all'}
            onChange={e => setEmailFilterParam('emailFrom', e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-sm max-w-[200px]"
            title="Filter by sender email (searches the whole 10-day window)"
          >
            <option value="all">All senders</option>
            {fromOptions.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        )}
        <a
          href={showDismissed ? '?' : '?dismissed=1'}
          className={[
            'inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border transition-colors',
            showDismissed
              ? 'bg-amber-100 text-amber-900 border-amber-300'
              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400',
          ].join(' ')}
          title="Toggle visibility of dismissed emails"
        >
          {showDismissed ? '✓ Show dismissed' : 'Show dismissed'}
        </a>
      </div>

      <div className="text-xs text-gray-400 mb-2">
        {threads.length} thread{threads.length === 1 ? '' : 's'} · {filtered.length} message{filtered.length === 1 ? '' : 's'}
        {emailTotal > emails.length && (
          <span className="text-amber-700">
            {' '}· showing the most recent {emails.length.toLocaleString()} of {emailTotal.toLocaleString()} matching
          </span>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Dir</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">From</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">To</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Persona</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last activity</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {threads.map(t => {
              const e          = t.latest
              const allDismissed = t.messages.every(m => !!m.dismissed_at)
              return (
              <>
                <tr key={t.key} className={['hover:bg-gray-50', allDismissed ? 'opacity-50' : ''].join(' ')}>
                  <td className="px-4 py-2.5 text-xs">
                    <span
                      title={e.direction === 'inbound' ? 'Received in a connected inbox' : 'Sent by MAIA or staff'}
                      className={[
                        'inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
                        e.direction === 'inbound' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800',
                      ].join(' ')}
                    >
                      {e.direction === 'inbound' ? 'In' : 'Out'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-900 truncate max-w-[200px]">{e.from_email ?? '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-700 truncate max-w-[200px]">{e.to_email ?? '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-700">
                    <div className="truncate max-w-[260px]">{e.subject ?? '—'}</div>
                    {t.count > 1 && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        +{t.count - 1} more in thread
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {e.persona && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] uppercase">{e.persona}</span>}
                  </td>
                  <td className="px-4 py-2.5">{emailStatusBadge(e.status)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{fmtDate(e.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpanded(expanded === t.key ? null : t.key)}
                        className="text-xs text-[#f26a1b] hover:underline"
                      >
                        {expanded === t.key ? 'Hide' : t.count > 1 ? `Show all (${t.count})` : 'Preview'}
                      </button>
                      <button
                        onClick={() => setLinkPickerCommId(e.id)}
                        title="Link this thread to a ticket or work order"
                        className="text-xs text-[#f26a1b] hover:underline"
                      >
                        + Ticket
                      </button>
                      {allDismissed ? (
                        <button
                          onClick={() => void restoreThread(t.key, t.ids, t.threadId)}
                          disabled={busyDismissId === t.key}
                          title="Restore this thread (all messages)"
                          className="text-xs text-gray-500 hover:text-emerald-700 disabled:opacity-40"
                        >
                          {busyDismissId === t.key ? '…' : 'Restore'}
                        </button>
                      ) : (
                        <button
                          onClick={() => void dismissThread(t.key, t.ids, t.threadId)}
                          disabled={busyDismissId === t.key}
                          title={t.count > 1 ? `Dismiss the entire thread (${t.count} messages)` : 'Dismiss — hide from default queue'}
                          className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-40"
                        >
                          {busyDismissId === t.key ? '…' : t.count > 1 ? 'Dismiss thread' : 'Dismiss'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded === t.key && (
                  <tr key={`${t.key}-preview`}>
                    <td colSpan={8} className="px-4 py-3 bg-amber-50 text-xs text-gray-600 border-b border-amber-100">
                      <div className="font-semibold text-gray-500 mb-2">
                        {t.count > 1 ? `${t.count} messages in this thread (oldest first)` : 'Preview'}
                      </div>
                      <div className="space-y-3">
                        {t.messages.map(m => (
                          <div
                            key={m.id}
                            className={[
                              'border border-gray-200 rounded bg-white p-2',
                              m.dismissed_at ? 'opacity-60' : '',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1 text-[11px] text-gray-500">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={[
                                  'inline-block px-1 py-0.5 rounded text-[9px] font-medium uppercase',
                                  m.direction === 'inbound' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800',
                                ].join(' ')}>
                                  {m.direction === 'inbound' ? 'In' : 'Out'}
                                </span>
                                <span className="text-gray-700">{m.from_email ?? '—'}</span>
                                <span>→</span>
                                <span className="text-gray-700">{m.to_email ?? '—'}</span>
                                {m.dismissed_at && (
                                  <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[9px] uppercase">
                                    dismissed
                                  </span>
                                )}
                              </div>
                              <span className="text-gray-400">{fmtDate(m.created_at)}</span>
                            </div>
                            {m.subject && m.subject !== e.subject && (
                              <div className="text-gray-700 font-medium mb-1">{m.subject}</div>
                            )}
                            {m.body_preview ? (
                              <div className="whitespace-pre-wrap text-gray-700">{m.body_preview}</div>
                            ) : (
                              <div className="text-gray-300 italic">No body preview.</div>
                            )}
                          </div>
                        ))}
                      </div>
                      <LinkedTicketsPanel
                        links={linksById[e.id] ?? []}
                        communicationType="email"
                        communicationId={e.id}
                        onLinked={(link) => pushLink(e.id, link)}
                        onUnlinked={(linkId) => dropLink(e.id, linkId)}
                      />
                    </td>
                  </tr>
                )}
              </>
              )
            })}
          </tbody>
        </table>

        {threads.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No emails match your filters.</div>
        )}
      </div>

      {linkPickerCommId && (
        <TicketPickerModal
          title="Link to ticket or work order"
          onClose={() => setLinkPickerCommId(null)}
          onConfirm={async (ticketId) => {
            const fresh = await createTicketLink('email', linkPickerCommId, ticketId)
            if (fresh) pushLink(linkPickerCommId, fresh)
          }}
        />
      )}
    </div>
  )
}

// ── Tab: Board Tickets ────────────────────────────────────────────────────────

function TicketsTab({ tickets, staff }: { tickets: Ticket[]; staff: Staff[] }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = tickets.filter(t => {
    if (filterStatus !== 'all' && (t.status ?? 'open') !== filterStatus) return false
    if (filterPriority !== 'all' && (t.priority ?? 'normal') !== filterPriority) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        (t.title ?? t.subject)?.toLowerCase().includes(q) ||
        t.contact_name?.toLowerCase().includes(q) ||
        t.association_code?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const staffById = Object.fromEntries(staff.map(s => [s.id, s.name]))

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search title, contact, association…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#f26a1b]"
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="all">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="text-xs text-gray-400 mb-2">{filtered.length} tickets</div>

      <div className="space-y-2">
        {filtered.map(t => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === t.id ? null : t.id)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5">🎫</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900">
                      {t.title ?? t.subject ?? `Ticket ${String(t.id).slice(0, 8)}`}
                    </span>
                    {statusBadge(t.status)}
                    {priorityBadge(t.priority)}
                    {(t.type ?? t.ticket_type) && (
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] uppercase">
                        {(t.type ?? t.ticket_type)!.replace(/_/g, ' ')}
                      </span>
                    )}
                    {t.association_code && (
                      <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px]">{t.association_code}</span>
                    )}
                  </div>
                  {t.contact_name && <p className="text-xs text-gray-500 mt-1">{t.contact_name} {t.contact_phone && `· ${t.contact_phone}`}</p>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-gray-400">{fmtDate(t.created_at)}</div>
                  {t.assigned_to && (
                    <div className="text-xs text-[#f26a1b] mt-0.5">→ {staffById[t.assigned_to] ?? t.assigned_to.slice(0, 8)}</div>
                  )}
                </div>
              </div>
            </button>

            {expanded === t.id && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 text-xs space-y-2">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <div><span className="text-gray-400">Contact:</span> {t.contact_name ?? '—'}</div>
                  <div><span className="text-gray-400">Phone:</span> {t.contact_phone ?? '—'}</div>
                  <div><span className="text-gray-400">Email:</span> {t.contact_email ?? '—'}</div>
                  <div><span className="text-gray-400">Channel:</span> {t.channel_source ?? '—'}</div>
                  <div><span className="text-gray-400">Created by:</span> {t.created_by ?? 'maia'}</div>
                  <div><span className="text-gray-400">Assigned:</span> {t.assigned_to ? (staffById[t.assigned_to] ?? t.assigned_to.slice(0, 8)) : '—'}</div>
                </div>
                {t.description && (
                  <div>
                    <div className="text-gray-400 font-semibold mb-1">Description</div>
                    <div className="whitespace-pre-wrap text-gray-700">{t.description}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No tickets match your filters.</div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Email Commands ───────────────────────────────────────────────────────

function cmdStatusBadge(status: string) {
  const map: Record<string, string> = {
    completed:  'bg-green-100 text-green-800',
    incomplete: 'bg-amber-100 text-amber-800',
    failed:     'bg-red-100 text-red-800',
    processing: 'bg-blue-100 text-blue-800',
    pending:    'bg-gray-100 text-gray-600',
  }
  const icon: Record<string, string> = {
    completed: '✅', incomplete: '⚠️', failed: '❌', processing: '⏳', pending: '⏳',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${map[status] ?? map.pending}`}>
      {icon[status] ?? ''} {status}
    </span>
  )
}

function EmailCommandsTab({ commands }: { commands: EmailCommand[] }) {
  const [search,       setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [expanded,     setExpanded]     = useState<string | null>(null)

  const filtered = commands.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        c.sender_email.toLowerCase().includes(q) ||
        c.sender_name?.toLowerCase().includes(q) ||
        c.subject?.toLowerCase().includes(q) ||
        c.reference_code?.toLowerCase().includes(q) ||
        c.record_type?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const completed  = commands.filter(c => c.status === 'completed').length
  const incomplete = commands.filter(c => c.status === 'incomplete').length
  const failed     = commands.filter(c => c.status === 'failed').length

  return (
    <div>
      {/* Mini stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3">
          <div className="text-xl font-semibold text-green-700">{completed}</div>
          <div className="text-xs text-green-600 font-medium uppercase tracking-wide">Completed</div>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
          <div className="text-xl font-semibold text-amber-700">{incomplete}</div>
          <div className="text-xs text-amber-600 font-medium uppercase tracking-wide">Incomplete</div>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <div className="text-xl font-semibold text-red-700">{failed}</div>
          <div className="text-xs text-red-600 font-medium uppercase tracking-wide">Failed</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search sender, subject, reference…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#f26a1b]"
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="incomplete">Incomplete</option>
          <option value="failed">Failed</option>
          <option value="processing">Processing</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      <div className="text-xs text-gray-400 mb-2">{filtered.length} email commands</div>

      <div className="space-y-2">
        {filtered.map(c => (
          <div key={c.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5">📧</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900">
                      {c.sender_name ?? c.sender_email}
                    </span>
                    <span className="text-xs text-gray-400">{c.sender_email}</span>
                    {cmdStatusBadge(c.status)}
                    {c.record_type && (
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] uppercase">
                        {c.record_type.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  {c.subject && <p className="text-xs text-gray-500 mt-1 truncate">{c.subject}</p>}
                  {c.reference_code && (
                    <p className="text-[10px] font-mono text-gray-400 mt-0.5">{c.reference_code}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-gray-400">{fmtDate(c.created_at)}</div>
                </div>
              </div>
            </button>

            {expanded === c.id && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 text-xs space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <div><span className="text-gray-400">Sender:</span> {c.sender_email}</div>
                  <div><span className="text-gray-400">Reply sent:</span> {c.reply_sent ? 'Yes' : 'No'}</div>
                  <div><span className="text-gray-400">DB table:</span> {c.db_table ?? '—'}</div>
                  <div><span className="text-gray-400">DB record ID:</span> {c.db_record_id ?? '—'}</div>
                  <div><span className="text-gray-400">Trigger:</span> <span className="font-mono">{c.trigger_phrase ?? '—'}</span></div>
                  <div><span className="text-gray-400">Reference:</span> <span className="font-mono">{c.reference_code ?? '—'}</span></div>
                </div>

                {c.error_message && (
                  <div className="bg-red-50 border border-red-100 rounded px-3 py-2">
                    <div className="font-semibold text-red-600 mb-1">Error</div>
                    <div className="font-mono text-red-700 whitespace-pre-wrap">{c.error_message}</div>
                  </div>
                )}

                {c.extracted_data && (
                  <div>
                    <div className="font-semibold text-gray-600 mb-1">Extracted Data</div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                      {(['first_name', 'last_name', 'entity_name', 'association_code', 'unit_number', 'email', 'phone', 'address'] as const).map(field => {
                        const val = (c.extracted_data as Record<string, unknown>)?.[field]
                        if (!val) return null
                        return (
                          <div key={field}><span className="text-gray-400">{field.replace(/_/g, ' ')}:</span> {String(val)}</div>
                        )
                      })}
                    </div>
                    {Array.isArray((c.extracted_data as Record<string, unknown>)?.missing_fields) &&
                      ((c.extracted_data as Record<string, unknown>).missing_fields as string[]).length > 0 && (
                      <div className="mt-2 text-amber-600">
                        <span className="font-semibold">Missing:</span> {((c.extracted_data as Record<string, unknown>).missing_fields as string[]).join(', ')}
                      </div>
                    )}
                  </div>
                )}

                {c.attachments && c.attachments.length > 0 && (
                  <div>
                    <div className="font-semibold text-gray-600 mb-1">Attachments</div>
                    <ul className="space-y-1">
                      {c.attachments.map((att, i) => (
                        <li key={i}>
                          {att.filename}
                          {att.url && (
                            <a href={att.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-[#f26a1b] hover:underline">view</a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {c.status === 'incomplete' && (
                  <div className="pt-1">
                    <a
                      href={`/admin?search=${encodeURIComponent([
                        (c.extracted_data as Record<string, unknown>)?.first_name,
                        (c.extracted_data as Record<string, unknown>)?.last_name,
                      ].filter(Boolean).join(' ') || '')}`}
                      className="inline-block bg-[#f26a1b] text-white text-[11px] font-semibold px-3 py-1.5 rounded hover:bg-[#f58140] transition-colors"
                    >
                      Fix manually →
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No email commands yet.
            {commands.length === 0 && (
              <div className="mt-2 text-xs">CC maia@pmitop.com and type <span className="font-mono">@Maia please add to the database</span> to get started.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function CommunicationsDashboard({
  conversations,
  emails,
  tickets,
  staff,
  emailCommands,
  canSeeAll                = true,
  showDismissed            = false,
  emailFromOptions          = [],
  emailToOptions            = [],
  conversationSenderOptions = [],
  emailTo                   = '',
  emailFrom                 = '',
  showConvArchived          = false,
  emailTotal                = 0,
}: Props) {
  const [tab, setTab] = useState<'conversations' | 'emails' | 'tickets' | 'commands'>('conversations')

  const openConvs   = conversations.filter(c => (c.status ?? 'open') === 'open').length
  const bouncedEmails = emails.filter(e => e.status === 'bounced').length
  const openTickets = tickets.filter(t => (t.status ?? 'open') === 'open').length
  const urgentTickets = tickets.filter(t => t.priority === 'urgent').length

  return (
    <div>
      {!canSeeAll && (
        <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
          <span className="font-semibold">Your view:</span> your own communications plus MAIA&apos;s mail and the unclaimed MAIA queue — pick up an item and attach it to a ticket. Owners see the full company view.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Open Conversations" value={openConvs} sub={`of ${conversations.length} total`} />
        <StatCard
          label="Emails"
          value={emailTotal}
          sub={emailTotal > emails.length ? `first ${emails.length} loaded` : (bouncedEmails ? `${bouncedEmails} bounced` : 'all delivered')}
        />
        <StatCard label="Open Tickets" value={openTickets} sub={`of ${tickets.length} total`} />
        <StatCard label="Urgent Tickets" value={urgentTickets} sub={urgentTickets > 0 ? 'needs attention' : 'none'} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-5">
        {([
          { key: 'conversations', label: `Conversations (${conversations.length})` },
          { key: 'emails',        label: `Emails (${emailTotal})` },
          { key: 'tickets',       label: `Board Tickets (${tickets.length})` },
          { key: 'commands',      label: `Email Commands (${emailCommands.length})` },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-[#f26a1b] text-[#f26a1b]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'conversations' && <ConversationsTab conversations={conversations} staff={staff} senderOptionsOverride={conversationSenderOptions} showArchived={showConvArchived} />}
      {tab === 'emails'        && <EmailsTab emails={emails} staff={staff} showDismissed={showDismissed} fromOptionsOverride={emailFromOptions} toOptionsOverride={emailToOptions} serverEmailTo={emailTo} serverEmailFrom={emailFrom} emailTotal={emailTotal} />}
      {tab === 'tickets'       && <TicketsTab tickets={tickets} staff={staff} />}
      {tab === 'commands'      && <EmailCommandsTab commands={emailCommands} />}
    </div>
  )
}
