'use client'

import { useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string
  session_id: string
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
}

interface Ticket {
  id: string
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
  created_by: string | null
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

interface Props {
  conversations: Conversation[]
  emails: EmailLog[]
  tickets: Ticket[]
  staff: Staff[]
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
    open:      'bg-amber-100 text-amber-800',
    resolved:  'bg-green-100 text-green-800',
    escalated: 'bg-red-100 text-red-800',
    closed:    'bg-gray-100 text-gray-600',
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
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = conversations.filter(c => {
    if (filterStatus !== 'all' && (c.status ?? 'open') !== filterStatus) return false
    if (filterChannel !== 'all' && c.channel !== filterChannel) return false
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
                      {c.contact_name ?? c.contact_phone ?? c.session_id.slice(0, 12)}
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
                  {c.summary && <p className="text-xs text-gray-500 mt-1 truncate">{c.summary}</p>}
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

function EmailsTab({ emails }: { emails: EmailLog[] }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = emails.filter(e => {
    if (filterStatus !== 'all' && (e.status ?? 'sent') !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.to_email?.toLowerCase().includes(q) ||
        e.subject?.toLowerCase().includes(q) ||
        e.persona?.toLowerCase().includes(q) ||
        e.association_code?.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search recipient, subject, association…"
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
      </div>

      <div className="text-xs text-gray-400 mb-2">{filtered.length} emails</div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
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
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-sm text-gray-900 truncate max-w-[160px]">{e.to_email ?? '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-700 truncate max-w-[220px]">{e.subject ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {e.persona && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] uppercase">{e.persona}</span>}
                  </td>
                  <td className="px-4 py-2.5">{emailStatusBadge(e.status)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{fmtDate(e.created_at)}</td>
                  <td className="px-4 py-2.5">
                    {e.body_preview && (
                      <button
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                        className="text-xs text-[#f26a1b] hover:underline"
                      >
                        {expanded === e.id ? 'Hide' : 'Preview'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === e.id && (
                  <tr key={`${e.id}-preview`}>
                    <td colSpan={6} className="px-4 py-3 bg-amber-50 text-xs text-gray-600 border-b border-amber-100">
                      <div className="font-semibold text-gray-500 mb-1">Preview</div>
                      <div className="whitespace-pre-wrap">{e.body_preview}</div>
                      {e.resend_message_id && (
                        <div className="mt-2 text-gray-400 font-mono">Resend ID: {e.resend_message_id}</div>
                      )}
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
                      {t.title ?? t.subject ?? `Ticket ${t.id.slice(0, 8)}`}
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

export default function CommunicationsDashboard({ conversations, emails, tickets, staff }: Props) {
  const [tab, setTab] = useState<'conversations' | 'emails' | 'tickets'>('conversations')

  const openConvs   = conversations.filter(c => (c.status ?? 'open') === 'open').length
  const bouncedEmails = emails.filter(e => e.status === 'bounced').length
  const openTickets = tickets.filter(t => (t.status ?? 'open') === 'open').length
  const urgentTickets = tickets.filter(t => t.priority === 'urgent').length

  return (
    <div>
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
      {tab === 'emails'        && <EmailsTab emails={emails} />}
      {tab === 'tickets'       && <TicketsTab tickets={tickets} staff={staff} />}
    </div>
  )
}
