// =====================================================================
// app/admin/tickets/[id]/components/TicketDetailClient.tsx
// Client component — full ticket detail: timeline, status/priority/
// assignee controls, reply box (email outbound via API), internal notes.
// =====================================================================

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import DueDateModal from './DueDateModal'

interface TicketRecord {
  id:                     number
  ticket_number:          string
  type:                   string
  status:                 string
  priority:               string
  channel_origin:         string
  association_code:       string | null
  persona:                string | null
  contact_name:           string | null
  contact_email:          string | null
  contact_phone:          string | null
  subject:                string | null
  summary:                string | null
  assignee_email:         string | null
  due_at:                 string | null
  resolved_at:            string | null
  gmail_thread_id:        string | null
  rentvine_workorder_id:  string | null
  cinc_workorder_id:      string | null
  work_order_type_id:     number | null
  work_order_type_name:   string | null
  sync_status:            Record<string, unknown> | null
  created_at:             string
  updated_at:             string
}

interface MessageRecord {
  id:           number
  direction:    string
  channel:      string
  from_addr:    string | null
  to_addr:      string | null
  subject:      string | null
  body:         string | null
  body_html:    string | null
  attachments:  unknown
  external_id:  string | null
  created_at:   string
}

interface EventRecord {
  id:          number
  actor_email: string | null
  event_type:  string
  payload:     Record<string, unknown> | null
  created_at:  string
}

interface WorkOrderRecord {
  ticket_id:     number
  vendor_email:  string | null
  vendor_name:   string | null
  unit_id:       string | null
  scheduled_at:  string | null
  completed_at:  string | null
  cost_cents:    number | null
  invoice_url:   string | null
}

export interface StaffMember {
  name:  string
  email: string
  role:  string | null
}

export interface TicketDetailData {
  ticket:           TicketRecord
  messages:         MessageRecord[]
  events:           EventRecord[]
  workOrder:        WorkOrderRecord | null
  staff:            StaffMember[]
  associationName:  string | null
}

const STATUS_OPTIONS   = ['open', 'pending', 'waiting_external', 'resolved', 'closed']
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent']

const STATUS_STYLES: Record<string, string> = {
  open:             'bg-green-100 text-green-800',
  pending:          'bg-yellow-100 text-yellow-800',
  waiting_external: 'bg-blue-100 text-blue-800',
  resolved:         'bg-slate-100 text-slate-700',
  closed:           'bg-gray-200 text-gray-600',
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high:   'bg-orange-100 text-orange-800',
  normal: 'bg-slate-100 text-slate-700',
  low:    'bg-gray-100 text-gray-600',
}

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', phone: 'Phone', web: 'Web', internal: 'Internal',
}

function fmtAbs(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

export default function TicketDetailClient({ data }: { data: TicketDetailData }) {
  const router = useRouter()
  const { ticket, messages, events, workOrder, staff, associationName } = data

  const [status,        setStatus]        = useState(ticket.status)
  const [priority,      setPriority]      = useState(ticket.priority)
  const [assignee,      setAssignee]      = useState(ticket.assignee_email ?? '')
  const [saving,        setSaving]        = useState<string | null>(null)
  type ReplyChannel = 'email' | 'sms' | 'whatsapp' | 'internal_note'
  const initialReplyChannel: ReplyChannel =
    (ticket.channel_origin === 'email'    && ticket.contact_email) ? 'email'    :
    (ticket.channel_origin === 'whatsapp' && ticket.contact_phone) ? 'whatsapp' :
    (ticket.channel_origin === 'sms'      && ticket.contact_phone) ? 'sms'      :
    'internal_note'
  const [replyChannel,  setReplyChannel]  = useState<ReplyChannel>(initialReplyChannel)
  const [replyBody,     setReplyBody]     = useState('')
  const [sending,       setSending]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [showDueModal,  setShowDueModal]  = useState(false)

  // CINC work-order type catalog — fetched lazily for work_order tickets so
  // staff can re-categorize after creation. Sync to CINC happens server-side
  // via the integration_outbox 'update_details' op.
  const [woTypeId,       setWoTypeId]       = useState<string>(ticket.work_order_type_id ? String(ticket.work_order_type_id) : '')
  const [woTypes,        setWoTypes]        = useState<Array<{ id: number; name: string }>>([])
  const [woTypesLoading, setWoTypesLoading] = useState(false)
  const [woTypesError,   setWoTypesError]   = useState<string | null>(null)

  useEffect(() => {
    if (ticket.type !== 'work_order' || woTypes.length > 0 || woTypesLoading) return
    setWoTypesLoading(true)
    setWoTypesError(null)
    fetch('/api/admin/cinc/work-order-types')
      .then(r => r.json())
      .then((data: { items?: Array<{ id: number; name: string }>; error?: string }) => {
        if (data.error) throw new Error(data.error)
        setWoTypes(data.items ?? [])
      })
      .catch(err => setWoTypesError(err instanceof Error ? err.message : String(err)))
      .finally(() => setWoTypesLoading(false))
  }, [ticket.type, woTypes.length, woTypesLoading])

  async function patch(field: string, value: string | null) {
    setSaving(field)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticket.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [field]: value }),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Update failed')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  /** PATCH multiple fields atomically. Used for type changes where both
   *  id and name flip together. `savingKey` drives the dropdown's
   *  disabled state. */
  async function patchFields(body: Record<string, unknown>, savingKey: string) {
    setSaving(savingKey)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticket.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Update failed')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  function onWoTypeChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    setWoTypeId(next)
    const chosen = woTypes.find(t => String(t.id) === next)
    void patchFields(
      {
        work_order_type_id:   chosen ? chosen.id   : null,
        work_order_type_name: chosen ? chosen.name : null,
      },
      'work_order_type_id',
    )
  }

  async function sendMessage() {
    if (!replyBody.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticket.id}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          direction: replyChannel === 'internal_note' ? 'internal_note' : 'outbound',
          channel:   replyChannel === 'internal_note' ? 'internal'      : replyChannel,
          body:      replyBody,
        }),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Send failed')
      setReplyBody('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  // Merge messages and events into a single chronological timeline.
  type TimelineItem =
    | { kind: 'message'; at: string; data: MessageRecord }
    | { kind: 'event';   at: string; data: EventRecord  }
  const timeline: TimelineItem[] = [
    ...messages.map(m => ({ kind: 'message' as const, at: m.created_at, data: m })),
    ...events  .map(e => ({ kind: 'event'   as const, at: e.created_at, data: e })),
  // Newest first — most recent activity is the most useful at-a-glance signal.
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  const overdue = ticket.due_at && new Date(ticket.due_at).getTime() < Date.now() && ticket.status !== 'resolved' && ticket.status !== 'closed'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      {/* Main column — timeline + reply */}
      <div>
        <div className="mb-4 flex items-center gap-3">
          <Link href={ticket.type === 'work_order' ? '/admin/work-orders' : '/admin/tickets'} className="text-sm text-gray-500 hover:text-gray-900">
            ← Back
          </Link>
          <span className="font-mono text-xs text-gray-500">{ticket.ticket_number}</span>
          <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_STYLES[ticket.status]}`}>
            {ticket.status.replace('_', ' ')}
          </span>
          <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_STYLES[ticket.priority]}`}>
            {ticket.priority}
          </span>
          {overdue && <span className="text-xs text-red-600 font-medium">Overdue</span>}
          {ticket.type === 'work_order' && (
            <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase">Work order</span>
          )}
          {/* Reclassify between work_order and ticket. Useful when an item came in
              via the CINC inbound feed but isn't really a maintenance work order
              (a billing question, general inquiry, etc.), or vice versa. The CINC
              record itself is untouched — only our local classification flips. */}
          <button
            type="button"
            onClick={() => {
              const target = ticket.type === 'work_order' ? 'ticket' : 'work_order'
              const verb   = ticket.type === 'work_order' ? 'Reclassify as ticket' : 'Reclassify as work order'
              if (confirm(`${verb}? CINC won't be modified — only how this is classified locally.`)) {
                patch('type', target)
              }
            }}
            disabled={saving === 'type'}
            className="text-[10px] text-gray-500 hover:text-[#f26a1b] underline disabled:opacity-50"
            title="Toggle between work_order and ticket. CINC record is not modified."
          >
            {saving === 'type'
              ? 'Reclassifying…'
              : ticket.type === 'work_order'
                ? '→ Reclassify as ticket'
                : '→ Reclassify as work order'}
          </button>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">{ticket.subject ?? '(no subject)'}</h1>
        <p className="text-sm text-gray-500 mb-6">
          {ticket.contact_name ?? ticket.contact_email ?? ticket.contact_phone ?? 'Unknown requester'}
          {ticket.persona && <span className="ml-2 capitalize text-gray-400">· {ticket.persona}</span>}
          <span className="ml-2 text-gray-400">· opened {fmtAbs(ticket.created_at)}</span>
        </p>

        {/* Timeline */}
        <div className="space-y-3 mb-6">
          {timeline.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-8 text-center text-sm text-gray-400">
              No activity yet.
            </div>
          )}
          {timeline.map(item => (
            <Fragment key={`${item.kind}-${item.data.id}`}>
              {item.kind === 'message' ? <MessageCard m={item.data} /> : <EventRow e={item.data} />}
            </Fragment>
          ))}
        </div>

        {/* Reply box */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <ReplyTab
              channel={replyChannel}
              value="email"
              label="✉️ Email"
              activeClass="bg-[#f26a1b] text-white"
              disabled={!ticket.contact_email}
              disabledTitle="No contact email on this ticket"
              onClick={() => setReplyChannel('email')}
            />
            <ReplyTab
              channel={replyChannel}
              value="sms"
              label="📱 SMS"
              activeClass="bg-blue-500 text-white"
              disabled={!ticket.contact_phone}
              disabledTitle="No contact phone on this ticket"
              onClick={() => setReplyChannel('sms')}
            />
            <ReplyTab
              channel={replyChannel}
              value="whatsapp"
              label="💬 WhatsApp"
              activeClass="bg-green-600 text-white"
              disabled={!ticket.contact_phone}
              disabledTitle="No contact phone on this ticket"
              onClick={() => setReplyChannel('whatsapp')}
            />
            <ReplyTab
              channel={replyChannel}
              value="internal_note"
              label="📝 Internal note"
              activeClass="bg-yellow-500 text-white"
              onClick={() => setReplyChannel('internal_note')}
            />
            {replyChannel === 'email'    && ticket.contact_email && (
              <span className="text-xs text-gray-500 ml-1">to <span className="font-mono">{ticket.contact_email}</span></span>
            )}
            {(replyChannel === 'sms' || replyChannel === 'whatsapp') && ticket.contact_phone && (
              <span className="text-xs text-gray-500 ml-1">to <span className="font-mono">{ticket.contact_phone}</span></span>
            )}
          </div>
          <textarea
            value={replyBody}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReplyBody(e.target.value)}
            rows={5}
            placeholder={
              replyChannel === 'internal_note' ? 'Internal note (not visible to customer)…' :
              replyChannel === 'sms'           ? 'Type your SMS reply (keep it short)…'    :
              replyChannel === 'whatsapp'      ? 'Type your WhatsApp reply…'                :
                                                 'Type your reply…'
            }
            className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-[#f26a1b]"
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-3">
              {error && <span className="text-xs text-red-600">{error}</span>}
              {(replyChannel === 'sms' || replyChannel === 'whatsapp') && replyBody && (
                <span className="text-xs text-gray-400">
                  {replyBody.length} chars
                  {replyChannel === 'sms' && replyBody.length > 160 && ` · ${Math.ceil(replyBody.length / 160)} segments`}
                </span>
              )}
            </div>
            <button
              onClick={sendMessage}
              disabled={sending || !replyBody.trim()}
              className="bg-[#f26a1b] text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14] disabled:opacity-50"
            >
              {sending ? 'Sending…' : (
                replyChannel === 'internal_note' ? 'Add note' :
                replyChannel === 'sms'           ? 'Send SMS' :
                replyChannel === 'whatsapp'      ? 'Send WhatsApp' :
                                                   'Send email'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Side panel — controls + metadata */}
      <aside className="space-y-4">
        <Card title="Status">
          <select
            value={status}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => { setStatus(e.target.value); patch('status', e.target.value) }}
            disabled={saving === 'status'}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm capitalize"
          >
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Card>

        <Card title="Priority">
          <select
            value={priority}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => { setPriority(e.target.value); patch('priority', e.target.value) }}
            disabled={saving === 'priority'}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm capitalize"
          >
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Card>

        <Card title="Assignee">
          <select
            value={assignee}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const next = e.target.value
              setAssignee(next)
              patch('assignee_email', next || null)
            }}
            disabled={saving === 'assignee_email'}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
          >
            <option value="">Unassigned</option>
            {staff.map(s => (
              <option key={s.email} value={s.email.toLowerCase()}>
                {s.name}{s.role ? ` · ${s.role}` : ''}
              </option>
            ))}
            {/* Preserve a value set via @assign that isn't in the staff list */}
            {assignee && !staff.some(s => s.email.toLowerCase() === assignee.toLowerCase()) && (
              <option value={assignee}>{assignee} (external)</option>
            )}
          </select>
        </Card>

        {ticket.type === 'work_order' && (
          <Card title="Work order type">
            <select
              value={woTypeId}
              onChange={onWoTypeChange}
              disabled={saving === 'work_order_type_id' || woTypesLoading}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
            >
              <option value="">
                {woTypesLoading ? 'Loading CINC types…' : (ticket.work_order_type_name ?? '— Unassigned')}
              </option>
              {woTypes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {woTypesError && (
              <div className="text-[10px] text-red-600 mt-1">
                Could not load CINC types: {woTypesError}
              </div>
            )}
            {ticket.cinc_workorder_id ? (
              <div className="text-[10px] text-gray-400 mt-1">Changes sync to CINC.</div>
            ) : (
              <div className="text-[10px] text-gray-400 mt-1">Not yet synced to CINC — change is local-only until the outbound create runs.</div>
            )}
          </Card>
        )}

        <Card title="Details">
          <Detail label="Channel"     value={CHANNEL_LABELS[ticket.channel_origin] ?? ticket.channel_origin} />
          <Detail
            label="Association"
            value={
              associationName && ticket.association_code
                ? `${associationName} (${ticket.association_code})`
                : (associationName ?? ticket.association_code ?? '—')
            }
          />
          <Detail label="Email"       value={ticket.contact_email   ?? '—'} mono />
          <Detail label="Phone"       value={ticket.contact_phone   ?? '—'} mono />
          <div className="flex items-baseline justify-between text-xs py-1">
            <span className="text-gray-400">Due</span>
            <button
              type="button"
              onClick={() => setShowDueModal(true)}
              className={['hover:underline', overdue ? 'text-red-600 font-medium' : 'text-gray-700'].join(' ')}
              title="Click to change due date with a reason"
            >
              {ticket.due_at ? fmtAbs(ticket.due_at) : '— set'}
            </button>
          </div>
          <Detail label="Updated"     value={fmtAbs(ticket.updated_at)} />
        </Card>

        {showDueModal && (
          <DueDateModal
            ticketId={ticket.id}
            currentDue={ticket.due_at}
            onClose={() => setShowDueModal(false)}
          />
        )}

        {workOrder && (
          <Card title="Work order">
            <Detail label="Vendor"    value={workOrder.vendor_name  ?? workOrder.vendor_email ?? '—'} />
            <Detail label="Unit"      value={workOrder.unit_id      ?? '—'} />
            <Detail label="Scheduled" value={workOrder.scheduled_at ? fmtAbs(workOrder.scheduled_at) : '—'} />
            <Detail label="Completed" value={workOrder.completed_at ? fmtAbs(workOrder.completed_at) : '—'} />
            <Detail label="Cost"      value={fmtMoney(workOrder.cost_cents)} />
          </Card>
        )}

        {ticket.type === 'work_order' && (() => {
          const sync = (ticket.sync_status ?? {}) as Record<string, { ok?: boolean; last_error?: string; last_synced_at?: string }>
          // Only show "pending sync" when sync_status[target] has been touched
          // (indicating an attempt was made). Otherwise show "—" — the ticket
          // simply doesn't sync to that integration. Prevents the misleading
          // "Rentvine: pending sync" on CINC-sourced tickets and vice versa.
          const cincLabel     = ticket.cinc_workorder_id     ?? (sync.cinc     ? 'pending sync' : '—')
          const rentvineLabel = ticket.rentvine_workorder_id ?? (sync.rentvine ? 'pending sync' : '—')
          const errors: string[] = []
          if (sync.cinc?.last_error)     errors.push(`CINC: ${sync.cinc.last_error}`)
          if (sync.rentvine?.last_error) errors.push(`Rentvine: ${sync.rentvine.last_error}`)
          return (
            <Card title="Sync status">
              <Detail label="Rentvine" value={rentvineLabel} mono />
              <Detail label="CINC"     value={cincLabel}     mono />
              {errors.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                  {errors.map((e, i) => (
                    <div key={i} className="text-[11px] text-red-600 break-words">{e}</div>
                  ))}
                </div>
              )}
            </Card>
          )
        })()}
      </aside>
    </div>
  )
}

function MessageCard({ m }: { m: MessageRecord }) {
  const isInbound  = m.direction === 'inbound'
  const isInternal = m.direction === 'internal_note'
  const bg         = isInternal ? 'bg-yellow-50 border-yellow-200' : (isInbound ? 'bg-white border-gray-200' : 'bg-blue-50 border-blue-100')
  const labelLeft  = isInternal ? 'Internal note' : (isInbound ? `${m.from_addr ?? 'External'} →` : `→ ${m.to_addr ?? 'External'}`)

  return (
    <div className={`border rounded-lg p-4 ${bg}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="font-medium">{labelLeft}</span>
          <span className="text-gray-400">via {m.channel}</span>
          {m.subject && <span className="text-gray-400 line-clamp-1 max-w-md">· {m.subject}</span>}
        </div>
        <span className="text-xs text-gray-400">{fmtAbs(m.created_at)}</span>
      </div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">{m.body ?? ''}</div>
    </div>
  )
}

function EventRow({ e }: { e: EventRecord }) {
  const desc = describeEvent(e)
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs text-gray-500">
      <span className="text-gray-300">●</span>
      <span>{desc}</span>
      <span className="text-gray-400">· {fmtAbs(e.created_at)}</span>
      {e.actor_email && e.actor_email !== 'system' && (
        <span className="text-gray-400">· by {e.actor_email}</span>
      )}
    </div>
  )
}

function describeEvent(e: EventRecord): string {
  const p = e.payload ?? {}
  switch (e.event_type) {
    case 'created':           return `Ticket created via ${(p as { channel_origin?: string }).channel_origin ?? 'unknown channel'}`
    case 'status_changed':    return `Status: ${(p as { from?: string }).from} → ${(p as { to?: string }).to}`
    case 'priority_changed':  return `Priority: ${(p as { from?: string }).from} → ${(p as { to?: string }).to}`
    case 'assigned':          return `Assigned: ${(p as { from?: string }).from ?? '—'} → ${(p as { to?: string }).to ?? '—'}`
    case 'type_changed':      return `Type: ${(p as { from?: string }).from} → ${(p as { to?: string }).to}`
    case 'work_order_type_changed': {
      const cast = p as { from_name?: string | null; to_name?: string | null }
      return `Work order type: ${cast.from_name ?? '—'} → ${cast.to_name ?? '—'}`
    }
    case 'message_added':     return `New ${(p as { direction?: string }).direction ?? ''} message via ${(p as { channel?: string }).channel ?? ''}`.trim()
    case 'due_changed': {
      const cast = p as { from?: string; to?: string; reason_label?: string; bucket?: string; note?: string }
      const fromStr = cast.from ? new Date(cast.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
      const toStr   = cast.to   ? new Date(cast.to)  .toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
      const tag     = cast.bucket === 'internal' ? ' [internal]' : ''
      const note    = cast.note ? ` — "${cast.note}"` : ''
      return `Due: ${fromStr} → ${toStr} (${cast.reason_label ?? 'no reason'})${tag}${note}`
    }
    default:                  return e.event_type
  }
}

function ReplyTab(props: {
  channel:        string
  value:          string
  label:          string
  activeClass:    string
  disabled?:      boolean
  disabledTitle?: string
  onClick:        () => void
}) {
  const isActive = props.channel === props.value
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.disabled ? props.disabledTitle : ''}
      className={[
        'px-3 py-1 text-xs rounded font-medium',
        isActive ? props.activeClass : 'bg-gray-100 text-gray-600',
        props.disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {props.label}
    </button>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</div>
      {children}
    </div>
  )
}

function Detail({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between text-xs py-1">
      <span className="text-gray-400">{label}</span>
      <span className={[mono ? 'font-mono' : '', highlight ? 'text-red-600 font-medium' : 'text-gray-700'].join(' ')}>
        {value}
      </span>
    </div>
  )
}
