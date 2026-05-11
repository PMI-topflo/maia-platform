// =====================================================================
// app/admin/tickets/components/NewTicketModal.tsx
// Client component — modal form for staff to manually create a ticket
// (phone call, walk-in, internal task). POSTs to /api/admin/tickets and
// navigates to the new ticket's detail page on success.
// =====================================================================

'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'

interface Association {
  association_code: string
  association_name: string
}

interface StaffMember {
  name:  string
  email: string
  role:  string | null
}

interface Props {
  associations: Association[]
  staff:        StaffMember[]
  defaultType:  'ticket' | 'work_order'
  onClose:      () => void
}

const CHANNEL_OPTIONS  = ['phone', 'web', 'internal', 'email', 'sms', 'whatsapp']
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent']
const PERSONA_OPTIONS  = ['owner', 'tenant', 'board', 'vendor', 'prospect', 'other']

export default function NewTicketModal({ associations, staff, defaultType, onClose }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const [type,             setType]             = useState<'ticket' | 'work_order'>(defaultType)
  const [channelOrigin,    setChannelOrigin]    = useState('phone')
  const [priority,         setPriority]         = useState('normal')
  const [persona,          setPersona]          = useState('')
  const [associationCode,  setAssociationCode]  = useState('')
  const [subject,          setSubject]          = useState('')
  const [contactName,      setContactName]      = useState('')
  const [contactEmail,     setContactEmail]     = useState('')
  const [contactPhone,     setContactPhone]     = useState('')
  const [assigneeEmail,    setAssigneeEmail]    = useState('')
  const [initialNote,      setInitialNote]      = useState('')
  const [workOrderTypeId,  setWorkOrderTypeId]  = useState<string>('')
  const [workOrderTypes,   setWorkOrderTypes]   = useState<Array<{ id: number; name: string }>>([])
  const [typesLoading,     setTypesLoading]     = useState(false)
  const [typesError,       setTypesError]       = useState<string | null>(null)

  // Fetch CINC work-order types lazily the first time type=work_order.
  // Cached in lib/integrations/cinc.ts so subsequent fetches don't hit CINC.
  useEffect(() => {
    if (type !== 'work_order' || workOrderTypes.length > 0 || typesLoading) return
    setTypesLoading(true)
    setTypesError(null)
    fetch('/api/admin/cinc/work-order-types')
      .then(r => r.json())
      .then((data: { items?: Array<{ id: number; name: string }>; error?: string }) => {
        if (data.error) throw new Error(data.error)
        setWorkOrderTypes(data.items ?? [])
      })
      .catch(err => setTypesError(err instanceof Error ? err.message : String(err)))
      .finally(() => setTypesLoading(false))
  }, [type, workOrderTypes.length, typesLoading])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!subject.trim()) {
      setError('Subject is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const chosenWoType = workOrderTypes.find(t => String(t.id) === workOrderTypeId)
      const res = await fetch('/api/admin/tickets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type,
          channel_origin:       channelOrigin,
          priority,
          persona:              persona          || null,
          association_code:     associationCode  || null,
          subject:              subject.trim(),
          contact_name:         contactName.trim()  || null,
          contact_email:        contactEmail.trim() || null,
          contact_phone:        contactPhone.trim() || null,
          assignee_email:       assigneeEmail.trim() || null,
          initial_note:         initialNote.trim()  || null,
          work_order_type_id:   type === 'work_order' && chosenWoType ? chosenWoType.id   : null,
          work_order_type_name: type === 'work_order' && chosenWoType ? chosenWoType.name : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Create failed')
      const id = data?.ticket?.id
      if (id) router.push(`/admin/tickets/${id}`)
      else { router.refresh(); onClose() }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-16 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">New {type === 'work_order' ? 'work order' : 'ticket'}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {/* Top row: type + channel + priority */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Type">
              <select
                value={type}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setType(e.target.value as 'ticket' | 'work_order')}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
              >
                <option value="ticket">Ticket</option>
                <option value="work_order">Work order</option>
              </select>
            </Field>

            <Field label="Channel">
              <select
                value={channelOrigin}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setChannelOrigin(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white capitalize"
              >
                {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>

            <Field label="Priority">
              <select
                value={priority}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPriority(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white capitalize"
              >
                {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>

          {/* Work order type — only shown for work orders. CINC requires a typeId on
              create; we show CINC's catalog so staff pick the right category
              (Plumbing, Roof Leak, Pool, etc.) instead of defaulting to Unassigned. */}
          {type === 'work_order' && (
            <Field label="Work order type">
              <select
                value={workOrderTypeId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setWorkOrderTypeId(e.target.value)}
                disabled={typesLoading}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
              >
                <option value="">
                  {typesLoading ? 'Loading CINC types…' : '— Default (CINC chooses)'}
                </option>
                {workOrderTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {typesError && (
                <span className="block text-[10px] text-red-600 mt-1">
                  Could not load CINC types: {typesError}
                </span>
              )}
            </Field>
          )}

          {/* Subject */}
          <Field label="Subject *">
            <input
              type="text"
              value={subject}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)}
              placeholder="Short description of the issue"
              required
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#f26a1b]"
            />
          </Field>

          {/* Contact section */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name">
              <input
                type="text"
                value={contactName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setContactName(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Persona">
              <select
                value={persona}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersona(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white capitalize"
              >
                <option value="">—</option>
                {PERSONA_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>

            <Field label="Contact email">
              <input
                type="email"
                value={contactEmail}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setContactEmail(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
              />
            </Field>
            <Field label="Contact phone">
              <input
                type="tel"
                value={contactPhone}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setContactPhone(e.target.value)}
                placeholder="+1XXXXXXXXXX"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
              />
            </Field>
          </div>

          {/* Association + assignee */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Association">
              <select
                value={associationCode}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setAssociationCode(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
              >
                <option value="">—</option>
                {associations.map(a => (
                  <option key={a.association_code} value={a.association_code}>
                    {a.association_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assignee">
              <select
                value={assigneeEmail}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setAssigneeEmail(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
              >
                <option value="">Unassigned</option>
                {staff.map(s => (
                  <option key={s.email} value={s.email.toLowerCase()}>
                    {s.name}{s.role ? ` · ${s.role}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Initial note */}
          <Field label="Initial note (optional)">
            <textarea
              value={initialNote}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setInitialNote(e.target.value)}
              rows={4}
              placeholder="Notes about the call / walk-in / context. Stored as an internal note on the ticket."
              className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-[#f26a1b]"
            />
          </Field>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !subject.trim()}
              className="bg-[#f26a1b] text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14] disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
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
