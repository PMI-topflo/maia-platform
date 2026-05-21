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
import ChangeReasonModal from './ChangeReasonModal'
import SchedulingModal from './SchedulingModal'
import VendorPickerModal from './VendorPickerModal'
import WorkOrderPhotos from './WorkOrderPhotos'
import LogMessageModal from './LogMessageModal'

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
  archived_at:            string | null
  marked_for_monthly_report: boolean | null
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
  happened_at: string
  created_at:  string
}

interface WorkOrderRecord {
  ticket_id:           number
  vendor_email:        string | null
  vendor_name:         string | null
  unit_id:             string | null
  scheduled_at:        string | null
  completed_at:        string | null
  cost_cents:          number | null
  invoice_url:         string | null
  cinc_ho_id:          string | null
  cinc_property_id:    number | null
  cinc_vendor_id:      number | null
  work_location_name:  string | null
  address_line1:       string | null
  address_line2:       string | null
  city:                string | null
  state:               string | null
  zip:                 string | null
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

/** Format the unit row. CINC tickets get "WorkLocationName (#HoID)";
 *  Rentvine falls back to `unit_id`. Either source may be missing. */
function fmtUnit(wo: WorkOrderRecord): string {
  if (wo.work_location_name && wo.cinc_ho_id) return `${wo.work_location_name} (#${wo.cinc_ho_id})`
  if (wo.work_location_name)                  return wo.work_location_name
  if (wo.cinc_ho_id)                          return `#${wo.cinc_ho_id}`
  if (wo.unit_id)                             return wo.unit_id
  return '—'
}

/** Combine the address parts CINC gives us into one display line.
 *  Returns null if there's nothing to show. */
function fmtAddress(wo: WorkOrderRecord): string | null {
  const parts: string[] = []
  if (wo.address_line1) parts.push(wo.address_line1)
  if (wo.address_line2) parts.push(wo.address_line2)
  const cityStateZip = [wo.city, wo.state, wo.zip].filter(Boolean).join(' ')
  if (cityStateZip) parts.push(cityStateZip)
  return parts.length > 0 ? parts.join(', ') : null
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
  const [logModalOpen,  setLogModalOpen]  = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [showDueModal,  setShowDueModal]  = useState(false)
  // Pending status/priority change held while ChangeReasonModal collects
  // the "when did this happen + why" inputs. Submitting the modal runs
  // the PATCH; cancelling reverts the local select to its prior value.
  const [pendingChange, setPendingChange] = useState<
    { field: 'status' | 'priority'; from: string; to: string } | null
  >(null)
  // Confirm-delete state. Holds the typed ticket number; only enables
  // the destructive button when it matches ticket.ticket_number.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [archiveBusy, setArchiveBusy] = useState(false)

  const [showSchedulingModal, setShowSchedulingModal] = useState(false)
  const [showVendorModal,     setShowVendorModal]     = useState(false)
  const [pushBusy,            setPushBusy]            = useState(false)

  async function pushToCinc() {
    setPushBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/work-orders/${ticket.id}/push-to-cinc`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Push failed')
      // The cron will populate cinc_workorder_id within ~1 min; refresh
      // to pick it up on the next render.
      setTimeout(() => router.refresh(), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPushBusy(false)
    }
  }

  async function archiveTicket(archive: boolean) {
    setArchiveBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticket.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ archive }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? `Archive ${archive ? '' : 'restore '}failed`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setArchiveBusy(false)
    }
  }

  async function deleteTicket() {
    setArchiveBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticket.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Delete failed')
      }
      // Ticket is gone — redirect to the appropriate list.
      router.push(ticket.type === 'work_order' ? '/admin/work-orders' : '/admin/tickets')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setArchiveBusy(false)
    }
  }

  // CINC work-order type catalog — fetched lazily for work_order tickets so
  // staff can re-categorize after creation. Sync to CINC happens server-side
  // via the integration_outbox 'update_details' op.
  const [woTypeId,       setWoTypeId]       = useState<string>(ticket.work_order_type_id ? String(ticket.work_order_type_id) : '')
  const [woTypes,        setWoTypes]        = useState<Array<{ id: number; name: string }>>([])
  const [woTypesLoading, setWoTypesLoading] = useState(false)
  const [woTypesError,   setWoTypesError]   = useState<string | null>(null)

  // "Include in monthly management report" flag — staff tick the work
  // orders they want to appear in the next monthly report (see
  // /admin/reports/monthly).
  const [monthlyReport, setMonthlyReport] = useState<boolean>(ticket.marked_for_monthly_report ?? false)
  const [savingMonthlyReport, setSavingMonthlyReport] = useState(false)

  async function toggleMonthlyReport(next: boolean) {
    setSavingMonthlyReport(true)
    const prev = monthlyReport
    setMonthlyReport(next)   // optimistic
    try {
      const res = await fetch(`/api/admin/work-orders/${ticket.id}/monthly-report`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ marked: next }),
      })
      if (!res.ok) {
        setMonthlyReport(prev)
        const j = await res.json().catch(() => ({}))
        alert(j?.error ?? 'Could not update the monthly-report flag')
      }
    } catch {
      setMonthlyReport(prev)
      alert('Network error — please try again.')
    } finally {
      setSavingMonthlyReport(false)
    }
  }

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
    ...messages.map(m => ({ kind: 'message' as const, at: m.created_at,  data: m })),
    // Use happened_at so backdated events slot into the timeline at the
    // moment they actually happened, not when MAIA logged them.
    ...events  .map(e => ({ kind: 'event'   as const, at: e.happened_at, data: e })),
  // Newest first — most recent activity is the most useful at-a-glance signal.
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  const overdue = ticket.due_at && new Date(ticket.due_at).getTime() < Date.now() && ticket.status !== 'resolved' && ticket.status !== 'closed'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      {/* Main column — timeline + reply */}
      <div>
        {ticket.archived_at && (
          <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
            <span className="font-semibold">Archived</span> on {fmtAbs(ticket.archived_at)}. Hidden from the default list. Restore from the Actions card to bring it back.
          </div>
        )}
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

        {/* Log past message — opens a modal that records a message
            that happened outside the platform (e.g. an SMS on a Dialpad
            line) into this ticket's timeline without sending anything. */}
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={() => setLogModalOpen(true)}
            className="text-xs text-gray-600 hover:text-[#f26a1b] underline"
            title="Record an SMS / call / WhatsApp that happened outside the platform"
          >
            📋 Log past message
          </button>
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
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const next = e.target.value
              if (next === status) return
              setStatus(next)
              setPendingChange({ field: 'status', from: status, to: next })
            }}
            disabled={saving === 'status'}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm capitalize"
          >
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Card>

        <Card title="Priority">
          <select
            value={priority}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const next = e.target.value
              if (next === priority) return
              setPriority(next)
              setPendingChange({ field: 'priority', from: priority, to: next })
            }}
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

        {pendingChange && (
          <ChangeReasonModal
            ticketId={ticket.id}
            field={pendingChange.field}
            fromValue={pendingChange.from}
            toValue={pendingChange.to}
            onClose={(committed) => {
              if (!committed) {
                // Revert the local select to its pre-change value.
                if (pendingChange.field === 'status')   setStatus(pendingChange.from)
                if (pendingChange.field === 'priority') setPriority(pendingChange.from)
              }
              setPendingChange(null)
            }}
          />
        )}

        {showSchedulingModal && workOrder && (
          <SchedulingModal
            ticketId={ticket.id}
            currentScheduled={workOrder.scheduled_at}
            onClose={() => setShowSchedulingModal(false)}
          />
        )}

        {showVendorModal && workOrder && (
          <VendorPickerModal
            ticketId={ticket.id}
            associationCode={ticket.association_code}
            currentVendorId={workOrder.cinc_vendor_id}
            currentVendorName={workOrder.vendor_name}
            onClose={() => setShowVendorModal(false)}
          />
        )}

        <LogMessageModal
          ticketId={ticket.id}
          open={logModalOpen}
          onClose={() => setLogModalOpen(false)}
          onSaved={() => router.refresh()}
        />

        {workOrder && (() => {
          const address = fmtAddress(workOrder)
          return (
            <Card title="Work order">
              <Detail
                label="CINC #"
                value={ticket.cinc_workorder_id ?? '— MAIA only'}
                mono
              />
              <Detail label="Unit"      value={fmtUnit(workOrder)} />
              {address && <Detail label="Address" value={address} />}
              <div className="flex items-center justify-between">
                <Detail label="Vendor"    value={workOrder.vendor_name  ?? workOrder.vendor_email ?? '—'} />
                <button
                  type="button"
                  onClick={() => setShowVendorModal(true)}
                  className="text-[10px] uppercase tracking-wide text-blue-600 hover:text-blue-800 ml-2"
                  title="Reassign to another CINC vendor"
                >
                  Reassign
                </button>
              </div>
              <div className="flex items-center justify-between">
                <Detail label="Scheduled" value={workOrder.scheduled_at ? fmtAbs(workOrder.scheduled_at) : '—'} />
                <button
                  type="button"
                  onClick={() => setShowSchedulingModal(true)}
                  className="text-[10px] uppercase tracking-wide text-blue-600 hover:text-blue-800 ml-2"
                  title="Edit Scheduled date"
                >
                  Edit
                </button>
              </div>
              <Detail label="Completed" value={workOrder.completed_at ? fmtAbs(workOrder.completed_at) : '—'} />
              <Detail label="Cost"      value={fmtMoney(workOrder.cost_cents)} />
              <div className="mt-2 pt-2 border-t border-gray-100">
                <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={monthlyReport}
                    disabled={savingMonthlyReport}
                    onChange={(e) => void toggleMonthlyReport(e.target.checked)}
                    className="h-4 w-4 accent-[#f26a1b]"
                  />
                  <span>Include in monthly management report</span>
                  {savingMonthlyReport && <span className="text-gray-400">saving…</span>}
                </label>
              </div>
              {!ticket.cinc_workorder_id && (
                <div className="mt-2 pt-2 border-t border-gray-100 space-y-2">
                  <div className="text-[11px] text-gray-500">
                    Created in MAIA without a CINC counterpart. New WOs sync automatically going forward; older orphans stay MAIA-only.
                  </div>
                  <button
                    type="button"
                    onClick={() => void pushToCinc()}
                    disabled={pushBusy}
                    className="w-full px-2 py-1 text-xs border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-50"
                  >
                    {pushBusy ? 'Queuing…' : 'Push to CINC'}
                  </button>
                </div>
              )}
            </Card>
          )
        })()}

        {ticket.type === 'work_order' && (
          <WorkOrderPhotos
            ticketId={ticket.id}
            hasCincWorkOrderId={!!ticket.cinc_workorder_id}
          />
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

        <Card title="Actions">
          {ticket.archived_at ? (
            <button
              type="button"
              onClick={() => void archiveTicket(false)}
              disabled={archiveBusy}
              className="w-full mb-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {archiveBusy ? 'Working…' : 'Restore'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void archiveTicket(true)}
              disabled={archiveBusy}
              className="w-full mb-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {archiveBusy ? 'Working…' : 'Archive'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={archiveBusy}
            className="w-full px-3 py-1.5 text-sm border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
          >
            Delete permanently…
          </button>
          <p className="mt-2 text-[11px] text-gray-400">
            Archive hides from the default list (restorable). Delete removes the ticket and all events, messages, and photos forever.
          </p>
        </Card>
      </aside>

      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !archiveBusy && setConfirmingDelete(false)}
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-red-700">Permanently delete ticket</h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-700">
                This will permanently delete <span className="font-mono">{ticket.ticket_number}</span> and all associated events, messages, and photos. <strong>This cannot be undone.</strong>
              </p>
              <p className="text-sm text-gray-700">
                Type <span className="font-mono font-semibold">{ticket.ticket_number}</span> to confirm:
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder={ticket.ticket_number}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-red-500"
                autoFocus
              />
              {error && <div className="text-xs text-red-600">{error}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={() => { setConfirmingDelete(false); setDeleteConfirmText('') }}
                disabled={archiveBusy}
                className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteTicket()}
                disabled={archiveBusy || deleteConfirmText !== ticket.ticket_number}
                className="bg-red-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {archiveBusy ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MessageCard({ m }: { m: MessageRecord }) {
  const isInbound  = m.direction === 'inbound'
  const isInternal = m.direction === 'internal_note'
  const isLogged   = typeof m.external_id === 'string' && m.external_id.startsWith('logged-')
  const bg         = isInternal ? 'bg-yellow-50 border-yellow-200' : (isInbound ? 'bg-white border-gray-200' : 'bg-blue-50 border-blue-100')
  const labelLeft  = isInternal ? 'Internal note' : (isInbound ? `${m.from_addr ?? 'External'} →` : `→ ${m.to_addr ?? 'External'}`)

  return (
    <div className={`border rounded-lg p-4 ${bg}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="font-medium">{labelLeft}</span>
          <span className="text-gray-400">via {m.channel}</span>
          {isLogged && (
            <span
              className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase"
              title="Manually logged — happened outside the platform"
            >
              📋 Logged
            </span>
          )}
          {m.subject && <span className="text-gray-400 line-clamp-1 max-w-md">· {m.subject}</span>}
        </div>
        <span className="text-xs text-gray-400">{fmtAbs(m.created_at)}</span>
      </div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">{m.body ?? ''}</div>
    </div>
  )
}

function EventRow({ e }: { e: EventRecord }) {
  const desc        = describeEvent(e)
  const reason      = typeof e.payload?.reason === 'string' ? e.payload.reason as string : null
  // Treat anything within 30 s as "logged at the time it happened" — no
  // backdating to call out. Bigger gaps surface a "recorded at" tag so
  // the audit trail is honest.
  const happenedMs  = new Date(e.happened_at).getTime()
  const recordedMs  = new Date(e.created_at).getTime()
  const wasBackdated = Math.abs(recordedMs - happenedMs) > 30_000

  return (
    <div className="flex items-start gap-2 px-2 py-1 text-xs text-gray-500">
      <span className="text-gray-300 mt-0.5">●</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span>{desc}</span>
          <span className="text-gray-400">· {fmtAbs(e.happened_at)}</span>
          {e.actor_email && e.actor_email !== 'system' && (
            <span className="text-gray-400">· by {e.actor_email}</span>
          )}
          {wasBackdated && (
            <span className="text-gray-400 italic" title={`MAIA recorded this at ${fmtAbs(e.created_at)}`}>
              · recorded {fmtAbs(e.created_at)}
            </span>
          )}
        </div>
        {reason && (
          <div className="mt-0.5 text-gray-600 italic">“{reason}”</div>
        )}
      </div>
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
    case 'archived':          return 'Archived'
    case 'restored':          return 'Restored from archive'
    case 'scheduled_changed': {
      const cast = p as { scheduled_at?: string | null }
      const when = cast.scheduled_at ? new Date(cast.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'cleared'
      return `Scheduled: ${when}`
    }
    case 'vendor_changed': {
      const cast = p as { vendor_name?: string | null; vendor_id?: number | null }
      return `Vendor: ${cast.vendor_name ?? `#${cast.vendor_id ?? '?'}`}`
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
