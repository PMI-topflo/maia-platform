'use client'

import { useEffect, useState } from 'react'
import TicketPickerModal from './TicketPickerModal'

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
            // Server returns a partial; fetch the full row by re-querying.
            const full = await fetch(
              `/api/admin/communications/links?type=${communicationType}&ids=${encodeURIComponent(communicationId)}`,
              { cache: 'no-store' },
            ).then(r => r.json())
            const fetched = (full?.links?.[communicationId] ?? []) as LinkedTicket[]
            const fresh = fetched.find(l => l.ticket_id === ticketId)
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

function ConversationsTab({ conversations, staff }: { conversations: Conversation[]; staff: Staff[] }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterChannel, setFilterChannel] = useState('all')
  const [filterAssignedTo, setFilterAssignedTo] = useState('all')
  const [filterFrom, setFilterFrom] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Distinct sender_email values for the "From" dropdown. Computed
  // from the full prop list so the options don't change as filters narrow.
  const senderOptions = Array.from(new Set(
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
      </div>

      <div className="text-xs text-gray-400 mb-2">{filtered.length} conversations</div>

      <div className="space-y-2">
        {filtered.map(c => (
          <div key={c.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
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
}: {
  emails:         EmailLog[]
  staff:          Staff[]
  showDismissed:  boolean
}) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSentBy, setFilterSentBy] = useState('all')
  const [filterTo, setFilterTo] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  // Local mirror so dismissing hides instantly (optimistic) and
  // restoring brings the row back without a page refresh.
  const [emails, setEmails] = useState<EmailLog[]>(emailsProp)
  // Keep in sync when the server returns a fresh batch (e.g. user
  // toggled "Show dismissed" which re-renders the page).
  useEffect(() => { setEmails(emailsProp) }, [emailsProp])

  const [busyDismissId, setBusyDismissId] = useState<string | null>(null)

  async function dismissEmail(id: string) {
    setBusyDismissId(id)
    try {
      const res = await fetch('/api/admin/communications/dismiss', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'email', id }),
      })
      if (res.ok) {
        if (showDismissed) {
          // Toggle is on — keep the row but mark it dismissed for the badge.
          setEmails(prev => prev.map(e => e.id === id ? { ...e, dismissed_at: new Date().toISOString() } : e))
        } else {
          setEmails(prev => prev.filter(e => e.id !== id))
        }
      }
    } finally {
      setBusyDismissId(null)
    }
  }

  async function restoreEmail(id: string) {
    setBusyDismissId(id)
    try {
      const res = await fetch(`/api/admin/communications/dismiss?type=email&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === id ? { ...e, dismissed_at: null, dismissed_by_email: null } : e))
      }
    } finally {
      setBusyDismissId(null)
    }
  }

  // Distinct to_email values for the "To" dropdown. Computed from
  // the full prop list so options don't change with active filters.
  const toOptions = Array.from(new Set(
    emails.map(e => (e.to_email ?? '').toLowerCase()).filter(Boolean),
  )).sort()

  const filtered = emails.filter(e => {
    if (filterStatus !== 'all' && (e.status ?? 'sent') !== filterStatus) return false
    if (filterTo !== 'all' && (e.to_email ?? '').toLowerCase() !== filterTo) return false
    if (filterSentBy !== 'all') {
      // sent_by can be either staff.id or staff.email depending on source.
      // Match either; '__unknown' picks anything blank.
      if (filterSentBy === '__unknown') {
        if (e.sent_by) return false
      } else {
        const staffRec = staff.find(s => s.id === filterSentBy)
        const emailLower = staffRec?.email?.toLowerCase() ?? ''
        if (e.sent_by !== filterSentBy && (e.sent_by ?? '').toLowerCase() !== emailLower) return false
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

  const { linksById, pushLink, dropLink } = useCommunicationLinks(
    'email',
    filtered.map(e => e.id),
  )

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
            value={filterTo}
            onChange={e => setFilterTo(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-sm max-w-[200px]"
            title="Filter by recipient email"
          >
            <option value="all">All recipients</option>
            {toOptions.map(t => (
              <option key={t} value={t}>{t}</option>
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

      <div className="text-xs text-gray-400 mb-2">{filtered.length} emails</div>

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
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sent</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(e => (
              <>
                <tr key={e.id} className={['hover:bg-gray-50', e.dismissed_at ? 'opacity-50' : ''].join(' ')}>
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
                  <td className="px-4 py-2.5 text-sm text-gray-700 truncate max-w-[220px]">{e.subject ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {e.persona && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] uppercase">{e.persona}</span>}
                  </td>
                  <td className="px-4 py-2.5">{emailStatusBadge(e.status)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{fmtDate(e.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {e.body_preview && (
                        <button
                          onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                          className="text-xs text-[#f26a1b] hover:underline"
                        >
                          {expanded === e.id ? 'Hide' : 'Preview'}
                        </button>
                      )}
                      {e.dismissed_at ? (
                        <button
                          onClick={() => void restoreEmail(e.id)}
                          disabled={busyDismissId === e.id}
                          title={`Dismissed${e.dismissed_by_email ? ` by ${e.dismissed_by_email}` : ''}. Click to restore.`}
                          className="text-xs text-gray-500 hover:text-emerald-700 disabled:opacity-40"
                        >
                          {busyDismissId === e.id ? '…' : 'Restore'}
                        </button>
                      ) : (
                        <button
                          onClick={() => void dismissEmail(e.id)}
                          disabled={busyDismissId === e.id}
                          title="Dismiss — hide from default queue (audit row kept)"
                          className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-40"
                        >
                          {busyDismissId === e.id ? '…' : 'Dismiss'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded === e.id && (
                  <tr key={`${e.id}-preview`}>
                    <td colSpan={8} className="px-4 py-3 bg-amber-50 text-xs text-gray-600 border-b border-amber-100">
                      <div className="font-semibold text-gray-500 mb-1">Preview</div>
                      <div className="whitespace-pre-wrap">{e.body_preview}</div>
                      {e.resend_message_id && (
                        <div className="mt-2 text-gray-400 font-mono">Resend ID: {e.resend_message_id}</div>
                      )}
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
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No emails match your filters.</div>
        )}
      </div>
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

export default function CommunicationsDashboard({ conversations, emails, tickets, staff, emailCommands, canSeeAll = true, showDismissed = false }: Props) {
  const [tab, setTab] = useState<'conversations' | 'emails' | 'tickets' | 'commands'>('conversations')

  const openConvs   = conversations.filter(c => (c.status ?? 'open') === 'open').length
  const bouncedEmails = emails.filter(e => e.status === 'bounced').length
  const openTickets = tickets.filter(t => (t.status ?? 'open') === 'open').length
  const urgentTickets = tickets.filter(t => t.priority === 'urgent').length

  return (
    <div>
      {!canSeeAll && (
        <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
          <span className="font-semibold">Restricted view:</span> showing only communications where you are the sender, recipient, or assignee. Owners and billing leads see the full company view.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Open Conversations" value={openConvs} sub={`of ${conversations.length} total`} />
        <StatCard label="Emails Sent" value={emails.length} sub={bouncedEmails ? `${bouncedEmails} bounced` : 'all delivered'} />
        <StatCard label="Open Tickets" value={openTickets} sub={`of ${tickets.length} total`} />
        <StatCard label="Urgent Tickets" value={urgentTickets} sub={urgentTickets > 0 ? 'needs attention' : 'none'} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-5">
        {([
          { key: 'conversations', label: `Conversations (${conversations.length})` },
          { key: 'emails',        label: `Emails (${emails.length})` },
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

      {tab === 'conversations' && <ConversationsTab conversations={conversations} staff={staff} />}
      {tab === 'emails'        && <EmailsTab emails={emails} staff={staff} showDismissed={showDismissed} />}
      {tab === 'tickets'       && <TicketsTab tickets={tickets} staff={staff} />}
      {tab === 'commands'      && <EmailCommandsTab commands={emailCommands} />}
    </div>
  )
}
