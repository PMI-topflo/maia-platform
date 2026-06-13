'use client'

// =====================================================================
// app/admin/components/ControlPanel.tsx
//
// The staff dashboard as an "airplane control panel": a grid of
// instrument tiles, each a status LED + big readout + label. Tiles that
// have an underlying list open an inline drawer below the grid when
// clicked (one at a time); tiles that are pure navigation link straight
// to their page. No always-on lists — the surface reads at a glance and
// drills down on demand.
// =====================================================================

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// ─── shared row types (also imported by the server page) ──────────────
export interface TicketRow {
  id:               number
  ticket_number:    string
  type:             string
  status:           string
  priority:         string
  subject:          string | null
  due_at:           string | null
  assignee_email:   string | null
  association_code: string | null
  contact_name:     string | null
}

export interface InvoiceDraftRow {
  id:                          number
  matched_vendor_name:         string | null
  matched_vendor_short_name:   string | null
  extracted_vendor_name:       string | null
  extracted_amount:            number | null
  extracted_association_code:  string | null
  extracted_invoice_number:    string | null
  status:                      string
  created_at:                  string
}

/** Where the actual file lives — system (uploaded, retrievable in-app),
 *  drive (link only), metadata (no document — a tracked date/fact like a
 *  Sunbiz filing), or none (a file is expected but not attached yet). */
export type FileSource = 'system' | 'drive' | 'metadata' | 'none'

/** A single compliance item with an expiry/deadline date. `scope` splits
 *  the dashboard into 🏢 Building (association/common-area) vs 🏠 Unit
 *  (per-unit) instruments. */
export interface ComplianceItem {
  scope:            'building' | 'unit'
  kind:             'insurance' | 'inspection' | 'document' | 'sunbiz' | 'lease' | 'unit_insurance' | 'permit' | 'violation'
  label:            string
  association_code: string | null
  date:             string   // YYYY-MM-DD (expiry / next-due / resolution date)
  source:           FileSource
  href:             string
}

export interface TeamAlert {
  key:    string
  label:  string
  count:  number
  href:   string
  urgent: boolean
}

export interface MaiaCommandRow {
  id:             string
  reference_code: string | null
  record_type:    string | null
  status:         string | null
  created_at:     string
  error_message:  string | null
  sender_email:   string | null
}

interface Counts {
  myTasks: number; overdue: number; workOrders: number; invoices: number
  applications: number; registrations: number; unidentified: number; tickets: number
  compliance: number; maiaErrors: number; owners: number; ownershipTransfers: number
  building: number; unit: number; vendorCompliance: number
}

/** This-week recurring-service reporting health, for the "Recurring Work
 *  Orders" tile (full breakdown lives on /admin/recurring-services/coverage). */
export interface RecurringCoverage {
  total:  number
  late:   number
  missed: number
  sev:    'nominal' | 'caution' | 'warning'
}

interface Props {
  counts:          Counts
  myTasks:         TicketRow[]
  workOrders:      TicketRow[]
  invoiceDrafts:   InvoiceDraftRow[]
  buildingItems:   ComplianceItem[]
  unitItems:       ComplianceItem[]
  teamAlerts:      TeamAlert[]
  recentCommands:  MaiaCommandRow[]
  candidateList:   string[]
  staffLookupHint: 'none' | 'matched' | 'no_match'
  recurring:       RecurringCoverage
}

type Severity = 'nominal' | 'caution' | 'warning'
type DrawerId = 'tasks' | 'workorders' | 'invoices' | 'building' | 'unit' | 'alerts' | 'maia'

// ─── presentation helpers ─────────────────────────────────────────────
const SEV_LED: Record<Severity, string> = {
  nominal: '#22c55e',   // green
  caution: '#f59e0b',   // amber
  warning: '#ef4444',   // red
}
const SEV_READOUT: Record<Severity, string> = {
  nominal: '#e5e7eb',
  caution: '#fbbf24',
  warning: '#f87171',
}

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

function dueLabel(due: string | null): { text: string; tone: 'overdue' | 'today' | 'soon' | 'later' | 'none' } {
  if (!due) return { text: 'No due date', tone: 'none' }
  const d = new Date(due)
  const now = new Date()
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date(startOfToday); endOfToday.setDate(endOfToday.getDate() + 1)
  if (d.getTime() < startOfToday.getTime()) return { text: `Overdue · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone: 'overdue' }
  if (d.getTime() < endOfToday.getTime()) return { text: `Due today · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, tone: 'today' }
  const inDays = Math.ceil((d.getTime() - now.getTime()) / 86_400_000)
  if (inDays <= 3) return { text: `In ${inDays}d · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone: 'soon' }
  return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'later' }
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - t.getTime()) / 86_400_000)
}

const KIND_ICON: Record<ComplianceItem['kind'], string> = {
  insurance: '🛡', inspection: '🏗', document: '📄', sunbiz: '🏛',
  lease: '📃', unit_insurance: '🛡', permit: '📋', violation: '⚠️',
}
const KIND_LABEL: Record<ComplianceItem['kind'], string> = {
  insurance: 'insurance', inspection: 'inspection', document: 'document', sunbiz: 'sunbiz',
  lease: 'lease', unit_insurance: 'insurance', permit: 'permit', violation: 'violation',
}

// 📦 = file uploaded into the system (retrievable in-app); 🗂 = link only
// (file lives in Google Drive); ∅ = nothing attached yet.
function SourceChip({ source }: { source: FileSource }) {
  const map: Record<FileSource, { icon: string; label: string; cls: string }> = {
    system:   { icon: '📦', label: 'in system', cls: 'bg-emerald-50 text-emerald-700' },
    drive:    { icon: '🗂', label: 'Drive',     cls: 'bg-blue-50 text-blue-700' },
    metadata: { icon: '📝', label: 'tracked',   cls: 'bg-gray-100 text-gray-500' },
    none:     { icon: '∅', label: 'no file',   cls: 'bg-amber-50 text-amber-700' },
  }
  const s = map[source]
  return (
    <span title={source === 'system' ? 'File uploaded into the system' : source === 'drive' ? 'Linked file lives in Google Drive' : source === 'metadata' ? 'No document — a tracked date/fact (e.g. Sunbiz filing)' : 'No file attached yet'}
      className={`inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] font-mono uppercase shrink-0 ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  )
}

// ─── main ──────────────────────────────────────────────────────────────
export default function ControlPanel(props: Props) {
  const { counts, myTasks, workOrders, invoiceDrafts, buildingItems, unitItems, teamAlerts, recentCommands, recurring } = props
  const [open, setOpen] = useState<DrawerId | null>(null)
  const router = useRouter()

  // Keep the panel live — it's a leave-it-open dashboard, but it's
  // server-rendered and won't otherwise reflect new invoices/tickets/alerts
  // until a manual reload. Re-pull the server data every 60s (only while the
  // tab is visible). router.refresh() preserves client state, so an open
  // drawer stays open and there's no flicker.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') router.refresh() }
    const id = setInterval(tick, 60_000)
    // Also refresh the moment the tab regains focus after being away.
    const onVis = () => { if (document.visibilityState === 'visible') router.refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [router])

  const overdue = (items: ComplianceItem[]) => items.filter(i => daysUntil(i.date) < 0).length
  const soon = (items: ComplianceItem[]) => items.filter(i => { const d = daysUntil(i.date); return d >= 0 && d <= 30 }).length
  const bldOverdue = overdue(buildingItems), bldSoon = soon(buildingItems)
  const unitOverdue = overdue(unitItems), unitSoon = soon(unitItems)
  const sevFor = (n: number, over: number) => over > 0 ? 'warning' as const : n > 0 ? 'caution' as const : 'nominal' as const
  const subFor = (n: number, over: number, sn: number) => over > 0 ? `${over} overdue · ${sn} ≤30d` : n > 0 ? `${sn} due ≤30d` : 'all current'

  // Each instrument: id, label, big value, sub, severity, and either a
  // drawer to open or an href to navigate.
  const instruments: Array<{
    id: string; label: string; value: number; sub: string; sev: Severity
    drawer?: DrawerId; href?: string
  }> = [
    {
      id: 'tasks', label: 'My Tasks', value: counts.myTasks,
      sub: counts.overdue > 0 ? `${counts.overdue} overdue` : counts.myTasks > 0 ? 'assigned to you' : 'all clear',
      sev: counts.overdue > 0 ? 'warning' : counts.myTasks > 0 ? 'caution' : 'nominal',
      drawer: 'tasks',
    },
    {
      id: 'building', label: 'Building Compliance', value: counts.building,
      sub: subFor(counts.building, bldOverdue, bldSoon),
      sev: sevFor(counts.building, bldOverdue),
      drawer: 'building',
    },
    {
      id: 'unit', label: 'Unit Compliance', value: counts.unit,
      sub: subFor(counts.unit, unitOverdue, unitSoon),
      sev: sevFor(counts.unit, unitOverdue),
      drawer: 'unit',
    },
    {
      id: 'workorders', label: 'Work Orders', value: counts.workOrders,
      sub: counts.workOrders > 0 ? 'active' : 'none open',
      sev: counts.workOrders > 0 ? 'caution' : 'nominal',
      drawer: 'workorders',
    },
    {
      id: 'recurring', label: 'Recurring Work Orders', value: recurring.total,
      sub: recurring.missed > 0
        ? `${recurring.missed} missed${recurring.late ? ` · ${recurring.late} late` : ''}`
        : recurring.late > 0
          ? `${recurring.late} late this week`
          : recurring.total > 0 ? 'all reported' : 'none configured',
      sev: recurring.sev,
      href: '/admin/recurring-services/coverage',
    },
    {
      id: 'vendorcompliance', label: 'Vendor Compliance', value: counts.vendorCompliance,
      sub: counts.vendorCompliance > 0 ? 'review vendor docs' : 'none active',
      sev: 'nominal',
      href: '/admin/vendor-compliance',
    },
    {
      id: 'invoices', label: 'Invoices', value: counts.invoices,
      sub: counts.invoices > 0 ? 'pending review' : 'queue empty',
      sev: counts.invoices > 0 ? 'caution' : 'nominal',
      drawer: 'invoices',
    },
    {
      id: 'alertqueue', label: 'Open Alerts', value: counts.compliance,
      sub: counts.compliance > 0 ? 'resolve on Audit →' : 'queue clear',
      sev: counts.compliance > 0 ? 'caution' : 'nominal',
      href: '/admin/audit',
    },
    {
      id: 'approvals', label: 'Pending Visitors', value: counts.unidentified,
      sub: counts.unidentified > 0 ? 'awaiting review' : 'none waiting',
      sev: counts.unidentified > 0 ? 'warning' : 'nominal',
      href: '/admin/pending-approvals',
    },
    {
      id: 'applications', label: 'Applications', value: counts.applications,
      sub: counts.applications > 0 ? 'awaiting board' : 'none pending',
      sev: counts.applications > 0 ? 'caution' : 'nominal',
      href: '/admin/applications',
    },
    {
      id: 'registrations', label: 'Registrations', value: counts.registrations,
      sub: counts.registrations > 0 ? 'agents/vendors' : 'none pending',
      sev: counts.registrations > 0 ? 'caution' : 'nominal',
      href: '/admin/registrations',
    },
    {
      id: 'maia', label: 'MAIA Errors', value: counts.maiaErrors,
      sub: counts.maiaErrors > 0 ? 'command errors' : 'running clean',
      sev: counts.maiaErrors > 0 ? 'warning' : 'nominal',
      drawer: 'maia',
    },
    {
      id: 'tickets', label: 'Open Tickets', value: counts.tickets,
      sub: 'across all teams', sev: 'nominal', href: '/admin/tickets',
    },
    {
      id: 'owners', label: 'Active Owners', value: counts.owners,
      sub: 'pick an association', sev: 'nominal', href: '/admin/cinc-sync',
    },
    {
      id: 'alerts', label: 'Team Alerts', value: teamAlerts.reduce((n, a) => n + a.count, 0),
      sub: teamAlerts.some(a => a.urgent) ? 'needs attention' : teamAlerts.length ? 'review' : 'all clear',
      sev: teamAlerts.some(a => a.urgent) ? 'warning' : teamAlerts.length ? 'caution' : 'nominal',
      drawer: 'alerts',
    },
  ]

  const warnings = instruments.filter(i => i.sev === 'warning').length
  const cautions = instruments.filter(i => i.sev === 'caution').length

  return (
    <div className="space-y-4">
      {/* ── Instrument cluster ── */}
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{ background: 'linear-gradient(180deg,#0d0d0d 0%,#15171c 100%)', border: '1px solid #23262e' }}
      >
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.25em] text-gray-400">Control Panel</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" style={{ boxShadow: '0 0 6px #22c55e' }} />
          </div>
          <div className="text-[10px] font-mono uppercase tracking-wider">
            {warnings > 0
              ? <span className="text-red-400">⚠ {warnings} warning{warnings === 1 ? '' : 's'}{cautions ? ` · ${cautions} caution` : ''}</span>
              : cautions > 0
                ? <span className="text-amber-400">{cautions} caution{cautions === 1 ? '' : 's'}</span>
                : <span className="text-green-400">all systems nominal</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {instruments.map(inst => {
            const isOpen = inst.drawer && open === inst.drawer
            const inner = (
              <>
                <div className="flex items-center justify-between">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: SEV_LED[inst.sev], boxShadow: `0 0 7px ${SEV_LED[inst.sev]}` }}
                  />
                  {inst.drawer
                    ? <span className="text-[9px] font-mono text-gray-500">{isOpen ? '▾ CLOSE' : 'OPEN ▸'}</span>
                    : <span className="text-[9px] font-mono text-gray-600 group-hover:text-[#f26a1b]">VIEW →</span>}
                </div>
                <div className="mt-2 text-3xl font-bold tabular-nums leading-none [font-family:var(--font-mono)]" style={{ color: SEV_READOUT[inst.sev] }}>
                  {inst.value > 999 ? '999+' : inst.value}
                </div>
                <div className="mt-1.5 text-[11px] font-semibold text-gray-200 uppercase tracking-wide [font-family:var(--font-mono)]">{inst.label}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{inst.sub}</div>
              </>
            )
            const tileCls = [
              'group text-left rounded-xl p-3.5 transition-all border',
              isOpen ? 'border-[#f26a1b]' : 'border-[#262a33] hover:border-[#3a3f4a]',
            ].join(' ')
            const tileStyle = {
              background: isOpen ? '#1c1f26' : '#15171c',
              boxShadow: isOpen ? '0 0 0 1px #f26a1b33, 0 0 18px #f26a1b22' : 'inset 0 1px 0 #ffffff08',
            }
            return inst.drawer ? (
              <button
                key={inst.id}
                onClick={() => setOpen(o => (o === inst.drawer ? null : inst.drawer!))}
                className={tileCls}
                style={tileStyle}
              >
                {inner}
              </button>
            ) : (
              <Link key={inst.id} href={inst.href!} className={tileCls} style={tileStyle}>
                {inner}
              </Link>
            )
          })}
        </div>

        {/* ── Utility / admin destinations ──
            Kept here (not in the top nav) so the primary bar stays short
            and legible. These are tools, not at-a-glance instruments. */}
        <div className="mt-4 pt-3 border-t border-[#23262e] flex flex-wrap items-center gap-x-1 gap-y-1.5">
          <span className="text-[9px] font-mono uppercase tracking-[0.25em] text-gray-600 mr-1">Admin tools</span>
          {[
            { label: 'Performance', href: '/admin/staff-performance' },
            { label: 'CINC Sync',   href: '/admin/cinc-sync' },
            { label: 'Sunbiz',      href: '/admin/sunbiz' },
            { label: 'Ideas',       href: '/admin/ideas' },
            { label: 'Tools',       href: '/admin/tools' },
          ].map(t => (
            <Link
              key={t.href}
              href={t.href}
              className="[font-family:var(--font-mono)] text-[0.62rem] uppercase tracking-[0.08em] px-2.5 py-1 rounded-[3px] text-gray-400 border border-[#262a33] hover:text-white hover:border-[#3a3f4a] transition-colors"
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Drill-down drawer ── */}
      {open === 'tasks'      && <Drawer title="My Tasks" accent="#f26a1b" href="/admin/tickets" onClose={() => setOpen(null)}>{
        myTasks.length === 0
          ? <EmptyTasks candidateList={props.candidateList} staffLookupHint={props.staffLookupHint} />
          : myTasks.map(t => <TicketLine key={t.id} t={t} />)
      }</Drawer>}

      {open === 'workorders' && <Drawer title="Active Work Orders" accent="#a855f7" href="/admin/work-orders" onClose={() => setOpen(null)}>{
        workOrders.length === 0
          ? <Empty>No active work orders.</Empty>
          : workOrders.map(t => <TicketLine key={t.id} t={t} showAssignee />)
      }</Drawer>}

      {open === 'invoices'   && <Drawer title="Pending Invoice Review" accent="#10b981" href="/admin/invoices" onClose={() => setOpen(null)}>{
        invoiceDrafts.length === 0
          ? <Empty>No invoices waiting. New ones land here when forwarded to <span className="font-mono">billing@</span>.</Empty>
          : invoiceDrafts.map(d => <InvoiceLine key={d.id} d={d} />)
      }</Drawer>}

      {open === 'building'   && <Drawer title="🏢 Building Compliance — association / common-area" accent="#ef4444" onClose={() => setOpen(null)}>{
        buildingItems.length === 0
          ? <Empty>Nothing due in the next 120 days. Master insurance, structural-safety inspections (SIRS / Milestone / Wind / Roof), and dated governing documents roll up here.</Empty>
          : buildingItems.map((it, i) => <ComplianceLine key={`bld-${i}`} it={it} />)
      }</Drawer>}

      {open === 'unit'       && <Drawer title="🏠 Unit Compliance — per-unit documents" accent="#ef4444" onClose={() => setOpen(null)}>{
        unitItems.length === 0
          ? <Empty>Nothing due in the next 120 days. Leases, unit (HO-6) insurance, city Certificates of Use, and violations roll up here. These files live in Drive — track the link + expiry.</Empty>
          : unitItems.map((it, i) => <ComplianceLine key={`unit-${i}`} it={it} />)
      }</Drawer>}

      {open === 'alerts'     && <Drawer title="Needs Attention (team)" accent="#f59e0b" onClose={() => setOpen(null)}>{
        teamAlerts.length === 0
          ? <Empty>No team-wide alerts.</Empty>
          : teamAlerts.map(a => (
              <Link key={a.key} href={a.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group">
                <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0 ${a.urgent ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{a.count}</div>
                <span className="text-sm text-gray-700 group-hover:text-gray-900">{a.label}</span>
                <span className="ml-auto text-gray-300 group-hover:text-[#f26a1b]">→</span>
              </Link>
            ))
      }</Drawer>}

      {open === 'maia'       && <Drawer title="Recent MAIA Activity" accent="#6b7280" href="/admin/communications" onClose={() => setOpen(null)}>{
        recentCommands.length === 0
          ? <Empty>No recent MAIA commands.</Empty>
          : recentCommands.map(cmd => (
              <div key={cmd.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cmd.status === 'error' ? 'bg-red-400' : cmd.status === 'processed' ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span className="text-[0.6rem] font-mono text-gray-400 shrink-0">{cmd.reference_code || cmd.id.slice(0, 8).toUpperCase()}</span>
                <span className="text-xs text-gray-700 flex-1 truncate">{cmd.record_type || cmd.sender_email}</span>
                {cmd.status === 'error' && cmd.error_message && <span className="text-[10px] text-red-500 truncate max-w-xs hidden md:block">{cmd.error_message}</span>}
                <span className="text-[10px] text-gray-300 shrink-0">{new Date(cmd.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            ))
      }</Drawer>}
    </div>
  )
}

// ─── drawer shell + row renderers ──────────────────────────────────────
function Drawer({ title, accent, href, onClose, children }: {
  title: string; accent: string; href?: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden animate-[fadeIn_0.12s_ease-out]">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-100" style={{ background: `${accent}0f` }}>
        <span className="text-xs font-semibold uppercase tracking-wide [font-family:var(--font-mono)]" style={{ color: accent }}>{title}</span>
        <div className="flex items-center gap-3">
          {href && <Link href={href} className="text-[0.6rem] font-mono text-gray-400 hover:text-gray-700 uppercase tracking-wide">View all →</Link>}
          <button onClick={onClose} className="text-[0.6rem] font-mono text-gray-400 hover:text-gray-700 uppercase tracking-wide">Close ✕</button>
        </div>
      </div>
      <div className="divide-y divide-gray-50 max-h-[28rem] overflow-y-auto">{children}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-gray-400">{children}</div>
}

function TicketLine({ t, showAssignee }: { t: TicketRow; showAssignee?: boolean }) {
  const due = dueLabel(t.due_at)
  const dueClass = due.tone === 'overdue' ? 'text-red-600 font-medium'
    : due.tone === 'today' ? 'text-amber-700 font-medium'
    : due.tone === 'soon' ? 'text-gray-700' : 'text-gray-400'
  return (
    <Link href={`/admin/tickets/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group">
      <span className="font-mono text-[10px] text-gray-400 shrink-0 w-[110px]">{t.ticket_number}</span>
      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase shrink-0 ${STATUS_STYLES[t.status] ?? 'bg-gray-100 text-gray-600'}`}>{t.status.replace('_', ' ')}</span>
      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase shrink-0 ${PRIORITY_STYLES[t.priority] ?? 'bg-gray-100 text-gray-600'}`}>{t.priority}</span>
      {t.type === 'work_order' && <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase shrink-0">WO</span>}
      <span className="text-sm text-gray-800 flex-1 truncate group-hover:text-gray-900">{t.subject ?? '(no subject)'}</span>
      {t.association_code && <span className="text-[10px] font-mono text-gray-400 shrink-0 hidden md:inline">{t.association_code}</span>}
      {showAssignee && (t.assignee_email
        ? <span className="text-[10px] font-mono text-gray-400 shrink-0 hidden md:inline truncate max-w-[140px]">{t.assignee_email}</span>
        : <span className="text-[10px] font-mono text-gray-300 shrink-0 hidden md:inline">unassigned</span>)}
      <span className={`text-[10px] shrink-0 ${dueClass} hidden sm:inline`}>{due.text}</span>
      <span className="text-gray-300 group-hover:text-[#f26a1b] shrink-0">→</span>
    </Link>
  )
}

function InvoiceLine({ d }: { d: InvoiceDraftRow }) {
  const vendor = d.matched_vendor_short_name || d.matched_vendor_name || d.extracted_vendor_name || '(unknown vendor)'
  const amount = d.extracted_amount != null ? `$${d.extracted_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
  const badge = d.status === 'needs_vendor' ? { label: 'Needs vendor', cls: 'bg-amber-100 text-amber-800' }
    : d.status === 'duplicate_in_cinc' ? { label: 'Duplicate', cls: 'bg-red-100 text-red-800' }
    : { label: 'Pending review', cls: 'bg-emerald-100 text-emerald-800' }
  return (
    <Link href="/admin/invoices" className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group">
      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase shrink-0 ${badge.cls}`}>{badge.label}</span>
      <span className="text-sm text-gray-800 truncate font-medium shrink-0 max-w-[200px]">{vendor}</span>
      <span className="text-sm text-gray-700 shrink-0 font-mono">{amount}</span>
      {d.extracted_invoice_number && <span className="text-[11px] text-gray-400 font-mono shrink-0 hidden md:inline">#{d.extracted_invoice_number}</span>}
      <span className="flex-1" />
      {d.extracted_association_code && <span className="text-[10px] font-mono text-gray-400 shrink-0 hidden md:inline">{d.extracted_association_code}</span>}
      <span className="text-[10px] text-gray-400 shrink-0 hidden sm:inline">{ageLabel(d.created_at)}</span>
      <span className="text-gray-300 group-hover:text-[#f26a1b] shrink-0">→</span>
    </Link>
  )
}

function ComplianceLine({ it }: { it: ComplianceItem }) {
  const days = daysUntil(it.date)
  const tone = days < 0 ? 'text-red-600 font-semibold' : days <= 30 ? 'text-amber-700 font-medium' : 'text-gray-500'
  const when = days < 0 ? `Overdue ${Math.abs(days)}d` : days === 0 ? 'Due today' : `In ${days}d`
  return (
    <Link href={it.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group">
      <span className="text-base shrink-0" aria-hidden>{KIND_ICON[it.kind]}</span>
      <span className="inline-flex rounded px-1.5 py-0.5 text-[9px] font-mono uppercase shrink-0 bg-gray-100 text-gray-500">{KIND_LABEL[it.kind]}</span>
      <span className="text-sm text-gray-800 flex-1 truncate group-hover:text-gray-900">{it.label}</span>
      <SourceChip source={it.source} />
      {it.association_code && <span className="text-[10px] font-mono text-gray-400 shrink-0 hidden md:inline">{it.association_code}</span>}
      <span className="text-[10px] font-mono text-gray-400 shrink-0 hidden sm:inline">{it.date}</span>
      <span className={`text-[10px] shrink-0 ${tone}`}>{when}</span>
      <span className="text-gray-300 group-hover:text-[#f26a1b] shrink-0">→</span>
    </Link>
  )
}

function EmptyTasks({ candidateList, staffLookupHint }: { candidateList: string[]; staffLookupHint: 'none' | 'matched' | 'no_match' }) {
  if (candidateList.length === 0) {
    return (
      <Empty>
        Couldn&apos;t identify your email from this session — it was signed before the recent auth update. Open the{' '}
        <Link href="/" className="text-[#f26a1b] hover:underline">homepage</Link>, click &quot;Not you?&quot;, sign back in, then refresh.
      </Empty>
    )
  }
  return (
    <Empty>
      Nothing assigned to <span className="font-mono text-gray-500">{candidateList.join(' / ')}</span>. Tickets must be{' '}
      <code className="text-[#f26a1b]">@assign</code>-ed to one of these addresses to appear here.
      {staffLookupHint === 'no_match' && (
        <div className="mt-2 text-[11px] text-amber-700">No <code className="bg-amber-50 px-1 rounded">pmi_staff</code> row matches this login email.</div>
      )}
    </Empty>
  )
}
