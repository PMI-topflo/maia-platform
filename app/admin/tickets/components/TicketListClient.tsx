// =====================================================================
// app/admin/tickets/components/TicketListClient.tsx
// Client component — interactive ticket list with status tabs, filter
// bar, and search. Filters are URL-driven so views are linkable.
// =====================================================================

'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useTransition, useState, useEffect, type ChangeEvent } from 'react'
import Link from 'next/link'
import NewTicketModal from './NewTicketModal'

export interface TicketRow {
  id:                   number
  ticket_number:        string
  type:                 string
  status:               string
  priority:             string
  channel_origin:       string
  association_code:     string | null
  persona:              string | null
  contact_name:         string | null
  contact_email:        string | null
  contact_phone:        string | null
  subject:              string | null
  summary:              string | null
  assignee_email:       string | null
  due_at:               string | null
  work_order_type_name: string | null
  created_at:           string
  updated_at:           string
}

interface Association {
  association_code: string
  association_name: string
}

interface ActiveFilters {
  status:      string
  priority:    string
  channel:     string
  association: string
  assignee:    string
  q:           string
  type:        string
  wo_type:     string
}

interface StaffMember {
  name:  string
  email: string
  role:  string | null
}

interface Props {
  rows:                  TicketRow[]
  associations:          Association[]
  staff:                 StaffMember[]
  countsByStatus:        Record<string, number>
  baseHref:              string
  showWorkOrderColumns:  boolean
  lockTypeTo:            'ticket' | 'work_order' | null
  woTypes:               string[]
  activeFilters:         ActiveFilters
}

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'open_any',         label: 'Open'      },
  { key: 'pending',          label: 'Pending'   },
  { key: 'waiting_external', label: 'Waiting'   },
  { key: 'resolved',         label: 'Resolved'  },
  { key: 'closed',           label: 'Closed'    },
  { key: 'all',              label: 'All'       },
]

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent']
const CHANNEL_OPTIONS  = ['email', 'whatsapp', 'sms', 'phone', 'web', 'internal']

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high:   'bg-orange-100 text-orange-800',
  normal: 'bg-slate-100 text-slate-700',
  low:    'bg-gray-100 text-gray-600',
}

const STATUS_STYLES: Record<string, string> = {
  open:             'bg-green-100 text-green-800',
  pending:          'bg-yellow-100 text-yellow-800',
  waiting_external: 'bg-blue-100 text-blue-800',
  resolved:         'bg-slate-100 text-slate-700',
  closed:           'bg-gray-200 text-gray-600',
}

const CHANNEL_ICONS: Record<string, string> = {
  email:    '✉️',
  whatsapp: '💬',
  sms:      '📱',
  phone:    '📞',
  web:      '🌐',
  internal: '📝',
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1)    return 'now'
  if (min < 60)   return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr  < 24)   return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7)    return `${day}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isOverdue(iso: string | null, status: string): boolean {
  if (!iso) return false
  if (status === 'resolved' || status === 'closed') return false
  return new Date(iso).getTime() < Date.now()
}

export default function TicketListClient(props: Props) {
  const router    = useRouter()
  const pathname  = usePathname()
  const [pending, startTransition] = useTransition()

  // Local search input — debounced into the URL so we don't refetch every keystroke.
  const [searchInput, setSearchInput] = useState(props.activeFilters.q)
  const [showNewModal, setShowNewModal] = useState(false)
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.activeFilters.q) updateFilter('q', searchInput)
    }, 350)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  function updateFilter(key: keyof ActiveFilters, value: string) {
    const next = new URLSearchParams()
    const merged = { ...props.activeFilters, [key]: value }
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== 'open_any' || (k === 'status' && v && v !== 'open_any')) {
        // Drop the "open_any" default to keep URLs clean.
        if (k === 'status' && v === 'open_any') continue
        if (v) next.set(k, v)
      }
    }
    const qs = next.toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname))
  }

  function clearAll() {
    setSearchInput('')
    startTransition(() => router.replace(pathname))
  }

  const activeFilterCount = (
    (props.activeFilters.priority    ? 1 : 0) +
    (props.activeFilters.channel     ? 1 : 0) +
    (props.activeFilters.association ? 1 : 0) +
    (props.activeFilters.assignee    ? 1 : 0) +
    (props.activeFilters.q           ? 1 : 0) +
    (props.activeFilters.type        ? 1 : 0) +
    (props.activeFilters.wo_type     ? 1 : 0)
  )

  const title = props.lockTypeTo === 'work_order' ? 'Work Orders' : 'Tickets'

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {props.rows.length} shown · {props.countsByStatus.open_any ?? 0} open
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pending && <span className="text-xs text-gray-400">Updating…</span>}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-gray-500 hover:text-gray-900 underline"
            >
              Clear filters
            </button>
          )}
          <button
            onClick={() => setShowNewModal(true)}
            className="bg-[#f26a1b] text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14]"
          >
            + New {props.lockTypeTo === 'work_order' ? 'work order' : 'ticket'}
          </button>
        </div>
      </div>

      {showNewModal && (
        <NewTicketModal
          associations={props.associations}
          staff={props.staff}
          defaultType={props.lockTypeTo === 'work_order' ? 'work_order' : 'ticket'}
          onClose={() => setShowNewModal(false)}
        />
      )}

      {/* Status tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        {STATUS_TABS.map(tab => {
          const active = (props.activeFilters.status || 'open_any') === tab.key
          const count  = props.countsByStatus[tab.key]
          return (
            <button
              key={tab.key}
              onClick={() => updateFilter('status', tab.key)}
              className={[
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-[#f26a1b] text-[#f26a1b]'
                  : 'border-transparent text-gray-500 hover:text-gray-900',
              ].join(' ')}
            >
              {tab.label}
              {count !== undefined && count > 0 && (
                <span className={`ml-1.5 text-xs ${active ? 'text-[#f26a1b]' : 'text-gray-400'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <input
          type="search"
          placeholder="Search subject, contact, ticket #…"
          value={searchInput}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-72 focus:outline-none focus:border-[#f26a1b]"
        />
        <FilterSelect
          value={props.activeFilters.priority}
          onChange={v => updateFilter('priority', v)}
          placeholder="Priority"
          options={PRIORITY_OPTIONS.map(p => ({ value: p, label: p }))}
        />
        <FilterSelect
          value={props.activeFilters.channel}
          onChange={v => updateFilter('channel', v)}
          placeholder="Channel"
          options={CHANNEL_OPTIONS.map(c => ({ value: c, label: c }))}
        />
        <FilterSelect
          value={props.activeFilters.association}
          onChange={v => updateFilter('association', v)}
          placeholder="Association"
          options={props.associations.map(a => ({ value: a.association_code, label: a.association_name }))}
        />
        {!props.lockTypeTo && (
          <FilterSelect
            value={props.activeFilters.type}
            onChange={v => updateFilter('type', v)}
            placeholder="Type"
            options={[
              { value: 'ticket',     label: 'Ticket'     },
              { value: 'work_order', label: 'Work order' },
            ]}
          />
        )}
        {props.showWorkOrderColumns && props.woTypes.length > 0 && (
          <FilterSelect
            value={props.activeFilters.wo_type}
            onChange={v => updateFilter('wo_type', v)}
            placeholder="Motive"
            options={props.woTypes.map(n => ({ value: n, label: n }))}
          />
        )}
        <input
          type="text"
          placeholder="Assignee email"
          value={props.activeFilters.assignee}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateFilter('assignee', e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48 focus:outline-none focus:border-[#f26a1b]"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 w-32">Number</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2 w-44">Requester</th>
              <th className="px-3 py-2 w-28">Association</th>
              <th className="px-3 py-2 w-20">Channel</th>
              {props.showWorkOrderColumns && <th className="px-3 py-2 w-32">Vendor</th>}
              {props.showWorkOrderColumns && <th className="px-3 py-2 w-28">Scheduled</th>}
              <th className="px-3 py-2 w-40">Assignee</th>
              <th className="px-3 py-2 w-24">Priority</th>
              <th className="px-3 py-2 w-28">Status</th>
              <th className="px-3 py-2 w-20 text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.length === 0 && (
              <tr>
                <td colSpan={props.showWorkOrderColumns ? 11 : 9} className="px-6 py-12 text-center text-sm text-gray-400">
                  No {title.toLowerCase()} match these filters.
                </td>
              </tr>
            )}
            {props.rows.map(t => (
              <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5 align-top">
                  <Link href={`${props.baseHref}/${t.id}`} className="font-mono text-xs text-[#f26a1b] hover:underline">
                    {t.ticket_number}
                  </Link>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <Link href={`${props.baseHref}/${t.id}`} className="block">
                    {t.work_order_type_name && (
                      <span className="inline-block mb-1 px-1.5 py-0.5 text-[10px] font-medium uppercase bg-indigo-100 text-indigo-800 rounded">
                        {t.work_order_type_name}
                      </span>
                    )}
                    <div className="font-medium text-gray-900 line-clamp-1">{t.subject ?? '—'}</div>
                    {t.summary && (
                      <div className="text-xs text-gray-500 line-clamp-1 mt-0.5">{t.summary}</div>
                    )}
                  </Link>
                </td>
                <td className="px-3 py-2.5 align-top text-gray-700">
                  <div className="line-clamp-1">{t.contact_name ?? t.contact_email ?? t.contact_phone ?? '—'}</div>
                  {t.persona && <div className="text-xs text-gray-400 capitalize">{t.persona}</div>}
                </td>
                <td className="px-3 py-2.5 align-top text-gray-600">{t.association_code ?? '—'}</td>
                <td className="px-3 py-2.5 align-top">
                  <span title={t.channel_origin}>{CHANNEL_ICONS[t.channel_origin] ?? '·'}</span>
                </td>
                {props.showWorkOrderColumns && <td className="px-3 py-2.5 align-top text-gray-500 text-xs">—</td>}
                {props.showWorkOrderColumns && <td className="px-3 py-2.5 align-top text-gray-500 text-xs">—</td>}
                <td className="px-3 py-2.5 align-top text-gray-600 text-xs">
                  {t.assignee_email ?? <span className="text-gray-400">Unassigned</span>}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_STYLES[t.priority] ?? 'bg-gray-100 text-gray-700'}`}>
                    {t.priority}
                  </span>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_STYLES[t.status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {t.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2.5 align-top text-right text-xs">
                  <div className={isOverdue(t.due_at, t.status) ? 'text-red-600 font-medium' : 'text-gray-500'}>
                    {fmtRelative(t.updated_at)}
                  </div>
                  {isOverdue(t.due_at, t.status) && (
                    <div className="text-[10px] text-red-500 mt-0.5">overdue</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function FilterSelect(props: {
  value:       string
  onChange:    (value: string) => void
  placeholder: string
  options:     Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={props.value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => props.onChange(e.target.value)}
      className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white capitalize focus:outline-none focus:border-[#f26a1b]"
    >
      <option value="">{props.placeholder}</option>
      {props.options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
