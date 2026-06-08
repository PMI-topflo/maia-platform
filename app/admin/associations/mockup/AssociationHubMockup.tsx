'use client'

// =====================================================================
// AssociationHubMockup.tsx
// Clickable design mockup of the unified Association Hub. STATIC sample
// data — nothing here calls an API. Switch tabs, open the Actions menu,
// and react to the layout. "Feeds from:" notes show where each section's
// real data will come from when we wire it into /admin/cinc-sync/[code].
// =====================================================================

import { useState } from 'react'

// ── Sample association (stand-in for live CINC + MAIA data) ──────────
const A = {
  name: 'Lakeview Club Condominium Association, Inc.',
  code: 'LCLUB',
  type: 'Condominium',
  units: 84,
  statute: 'FL 718 (Condo)',
  service: 'Full Management',
  operating: 142_530.18,
  reserve: 318_904.55,
  openInvoices: 3,
  upcomingPayments: 2,
  openWorkOrders: 5,
  vendors: 11,
  expiringCOIs: 2,
}

const BOARD = [
  { role: 'President',  name: 'María Restrepo',   email: 'm.restrepo@example.com', phone: '(305) 555-0142' },
  { role: 'Treasurer',  name: 'David Okafor',     email: 'd.okafor@example.com',   phone: '(305) 555-0177' },
  { role: 'Secretary',  name: 'Aileen Brooks',    email: 'a.brooks@example.com',   phone: '(305) 555-0190' },
]

const VENDORS = [
  { name: 'AB Electric',        type: 'Electrical', coi: 'ok',   w9: 'ok',   ach: 'ok',   lic: 'ok',   note: 'Expires 11/2026' },
  { name: 'Testa & Sons Signs', type: 'Signage',    coi: 'warn', w9: 'ok',   ach: 'none', lic: 'ok',   note: 'COI expires in 21 days' },
  { name: 'Hidden Eyes LLC',    type: 'Security',   coi: 'bad',  w9: 'ok',   ach: 'ok',   lic: 'warn', note: 'COI expired 05/2026' },
]

const WORKORDERS = [
  { ref: 'TKT-2026-0075', title: 'Pump stopped working — pool equipment', vendor: 'AB Electric', status: 'open',    due: 'Jun 8' },
  { ref: 'TKT-2026-0061', title: 'Lobby light fixtures flickering',       vendor: 'AB Electric', status: 'pending', due: 'Jun 12' },
  { ref: 'TKT-2026-0048', title: 'Replace damaged entrance sign',         vendor: 'Testa & Sons', status: 'open',   due: 'Jun 15' },
]

const DOCS = [
  { name: 'Declaration of Condominium.pdf', cat: 'Governing', date: '2019-04-02' },
  { name: 'Bylaws (amended 2023).pdf',      cat: 'Governing', date: '2023-08-11' },
  { name: 'Property COI 2026.pdf',          cat: 'Insurance', date: '2026-01-09', expires: '2027-01-09' },
  { name: 'Milestone Inspection (SB-4D).pdf', cat: 'Safety',  date: '2025-12-01' },
]

const THREADS = [
  { with: 'Board · María Restrepo', last: 'Approved the pool pump estimate — please proceed.', when: '2h ago', kind: 'board', unread: true },
  { with: 'AB Electric',            last: 'Sent revised estimate ($4,820) for the pump.',       when: '5h ago', kind: 'vendor', unread: true },
  { with: 'Board · David Okafor',   last: 'Can you send the May financials before the meeting?', when: 'Yesterday', kind: 'board', unread: false },
  { with: 'Testa & Sons Signs',     last: 'We can install the new sign next Tuesday.',           when: '2 days ago', kind: 'vendor', unread: false },
]

const ACTIONS = [
  { label: 'New Work Order',          hint: 'opens the New WO modal, pre-set to this association' },
  { label: 'Add Invoice / Bill',      hint: 'invoice intake, pre-filled assoc' },
  { label: 'Message Board Members',   hint: 'compose to selected officers' },
  { label: 'Email a Vendor',          hint: 'request estimate / send WO link' },
  { label: 'Add Owner',               hint: 'new owner record' },
  { label: 'Upload Document',         hint: 'governing / insurance / safety' },
  { label: 'Record Insurance / COI',  hint: 'add a policy + expiry' },
  { divider: true },
  { label: 'Run Monthly Report',      hint: 'board report for this assoc' },
  { label: 'Reconcile Month',         hint: 'opens reconciliation for this assoc' },
  { divider: true },
  { label: 'Sync from CINC',          hint: 'owner/board diff + apply' },
  { label: 'Edit Association',        hint: 'type, statute, service level' },
]

const TABS = ['Overview', 'Board & Owners', 'Vendors', 'Work Orders', 'Maintenance', 'Projects', 'Inspections', 'Financials', 'Budget', 'Documents & Compliance', 'Communications', 'Reports'] as const
type Tab = typeof TABS[number]

// ── Projects + Inspections sample data ──────────────────────────────
const PROJECTS = [
  { name: 'Roof replacement — Bldg A', status: 'In progress', vendor: 'Apex Roofing', budget: 185000, spent: 96000, target: 'Aug 2026', pct: 52 },
  { name: '40-year recertification',   status: 'Bidding',     vendor: '—',            budget: 42000,  spent: 0,     target: 'Dec 2026', pct: 10 },
  { name: 'Lobby & hallway repaint',   status: 'Planning',    vendor: 'ColorPro',     budget: 28000,  spent: 0,     target: 'Oct 2026', pct: 0 },
  { name: 'Pool deck resurfacing',     status: 'Complete',    vendor: 'AquaDeck',     budget: 21000,  spent: 20450, target: 'Apr 2026', pct: 100 },
]
const PROJ_STATUS: Record<string, string> = {
  'Planning':    'bg-gray-100 text-gray-700',
  'Bidding':     'bg-amber-100 text-amber-800',
  'In progress': 'bg-blue-100 text-blue-800',
  'Complete':    'bg-emerald-100 text-emerald-800',
}

const INSPECTIONS = [
  { type: 'Milestone inspection (SB-4D)', last: '2025-12-01', next: '2035-12-01', status: 'ok',      who: 'StructEng FL' },
  { type: 'Reserve study',                last: '2024-03-15', next: '2027-03-15', status: 'ok',      who: 'AccuReserve' },
  { type: 'Fire alarm / sprinkler',       last: '2026-03-18', next: '2026-09-18', status: 'due',     who: 'SafeGuard Fire' },
  { type: 'Elevator certification',       last: '2025-06-12', next: '2026-06-12', status: 'overdue', who: 'ThyssenKrupp' },
  { type: 'Backflow / water',             last: '2026-01-20', next: '2027-01-20', status: 'ok',      who: 'Vista Plumbing' },
]
const INSP_STATUS: Record<string, string> = { ok: 'bg-emerald-100 text-emerald-800', due: 'bg-amber-100 text-amber-800', overdue: 'bg-red-100 text-red-800' }
const INSP_LABEL:  Record<string, string> = { ok: 'Current', due: 'Due soon', overdue: 'Overdue' }

// ── Maintenance / calendar / budget sample data ─────────────────────
const PREVENTIVE = [
  { name: 'Pool chemical service', cadence: 'Weekly · Mon',     vendor: 'AquaPro',        next: 'Jun 8' },
  { name: 'Elevator inspection',   cadence: 'Monthly',          vendor: 'ThyssenKrupp',   next: 'Jun 12' },
  { name: 'Fire alarm test',       cadence: 'Quarterly',        vendor: 'SafeGuard Fire', next: 'Jun 18' },
  { name: 'HVAC filter change',    cadence: 'Monthly',          vendor: 'CoolAir HVAC',   next: 'Jun 25' },
  { name: 'Roof / gutter inspection', cadence: 'Annual',        vendor: 'Apex Roofing',   next: 'Nov 3' },
]

const BY_CATEGORY = [
  { c: 'Landscaping', n: 8 }, { c: 'Plumbing', n: 6 }, { c: 'HVAC', n: 5 },
  { c: 'Electrical', n: 4 }, { c: 'Cleaning', n: 3 },
]
const EXPIRING_INS = [
  { v: 'Testa & Sons Signs', days: 21 },
  { v: 'Hidden Eyes LLC',    days: -33 },
]
const BUDGET = [
  { cat: 'R&M — General',  b: 48000, a: 31200 },
  { cat: 'Landscaping',    b: 36000, a: 34500 },
  { cat: 'Pool',           b: 18000, a: 9800 },
  { cat: 'Elevator',       b: 12000, a: 11000 },
  { cat: 'Insurance',      b: 96000, a: 96000 },
  { cat: 'Utilities',      b: 54000, a: 41200 },
]

// Calendar events keyed by June-2026 day number.
const CAL_EVENTS: Record<number, { t: string; k: string }[]> = {
  1:  [{ t: 'Pool service', k: 'pool' }],
  3:  [{ t: 'Landscaping', k: 'land' }],
  8:  [{ t: 'Pool service', k: 'pool' }],
  9:  [{ t: 'Pressure-wash garage', k: 'clean' }],
  10: [{ t: 'Landscaping', k: 'land' }],
  12: [{ t: 'Elevator inspection', k: 'insp' }],
  15: [{ t: 'Pool service', k: 'pool' }],
  17: [{ t: 'Landscaping', k: 'land' }],
  18: [{ t: 'Fire alarm test', k: 'safety' }],
  22: [{ t: 'Pool service', k: 'pool' }],
  24: [{ t: 'Landscaping', k: 'land' }],
  25: [{ t: 'HVAC filter change', k: 'hvac' }],
  29: [{ t: 'Pool service', k: 'pool' }],
}
const EVK: Record<string, string> = {
  pool:   'bg-teal-100 text-teal-800',
  land:   'bg-green-100 text-green-800',
  insp:   'bg-indigo-100 text-indigo-800',
  safety: 'bg-red-100 text-red-800',
  hvac:   'bg-amber-100 text-amber-800',
  clean:  'bg-sky-100 text-sky-800',
}
// Sun-start month grid for June 2026 (Jun 1 = Monday). o = outside month.
const MONTH: { d: number; o?: boolean }[] = [
  { d: 31, o: true }, { d: 1 }, { d: 2 }, { d: 3 }, { d: 4 }, { d: 5 }, { d: 6 },
  { d: 7 }, { d: 8 }, { d: 9 }, { d: 10 }, { d: 11 }, { d: 12 }, { d: 13 },
  { d: 14 }, { d: 15 }, { d: 16 }, { d: 17 }, { d: 18 }, { d: 19 }, { d: 20 },
  { d: 21 }, { d: 22 }, { d: 23 }, { d: 24 }, { d: 25 }, { d: 26 }, { d: 27 },
  { d: 28 }, { d: 29 }, { d: 30 }, { d: 1, o: true }, { d: 2, o: true }, { d: 3, o: true }, { d: 4, o: true },
]
const WEEK_DAYS: readonly (readonly [string, number])[]  = [['Sun', 7], ['Mon', 8], ['Tue', 9], ['Wed', 10], ['Thu', 11], ['Fri', 12], ['Sat', 13]]
const THREE_DAYS: readonly (readonly [string, number])[] = [['Mon', 8], ['Tue', 9], ['Wed', 10]]

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const RAG: Record<string, { dot: string; label: string }> = {
  ok:   { dot: 'bg-emerald-500', label: 'OK' },
  warn: { dot: 'bg-amber-500',   label: 'Expiring' },
  bad:  { dot: 'bg-red-500',     label: 'Expired' },
  none: { dot: 'bg-gray-300',    label: 'Missing' },
}

function FeedsFrom({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[11px] text-gray-400 italic">Feeds from: {children}</p>
}

function Card({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {action && <button className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]">{action}</button>}
      </div>
      {children}
    </div>
  )
}

export default function AssociationHubMockup() {
  const [tab, setTab] = useState<Tab>('Overview')
  const [actionsOpen, setActionsOpen] = useState(false)

  return (
    <div onClick={() => actionsOpen && setActionsOpen(false)}>
      {/* Mockup banner */}
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <strong>Design mockup</strong> — sample data, nothing is wired to the backend. Click the tabs and the <strong>Actions</strong> menu to feel the navigation. Once you approve the layout it folds into <span className="font-mono">/admin/cinc-sync/[code]</span> with live data.
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-1 text-xs text-gray-400">Associations / {A.name}</div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            {A.name}
            <span className="text-gray-300 cursor-pointer" title="Switch association">▾</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="font-mono rounded bg-gray-100 px-1.5 py-0.5">{A.code}</span>
            <span>· {A.type}</span><span>· {A.units} units</span>
            <span>· {A.statute}</span><span>· {A.service}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Run Monthly Report</button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setActionsOpen(o => !o) }}
              className="rounded bg-[#16a34a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#15803d]"
            >Actions ▾</button>
            {actionsOpen && (
              <div onClick={e => e.stopPropagation()} className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                {ACTIONS.map((a, i) => a.divider ? (
                  <div key={i} className="my-1 border-t border-gray-100" />
                ) : (
                  <button key={i} className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-gray-50">
                    <span className="text-sm text-gray-800">{a.label}</span>
                    <span className="text-[10px] text-gray-400">{a.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t ? 'border-[#f26a1b] text-[#f26a1b]' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >{t}</button>
        ))}
      </div>

      {/* ── Body: left identity rail + tab content ─────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        {/* Identity rail (always visible, like RentVine's left column) */}
        <aside className="space-y-4">
          <Card title="Snapshot">
            <dl className="space-y-1.5 text-sm">
              <Row k="Operating">{money(A.operating)}</Row>
              <Row k="Reserves">{money(A.reserve)}</Row>
              <Row k="Open invoices">{A.openInvoices}</Row>
              <Row k="Upcoming payments">{A.upcomingPayments}</Row>
              <Row k="Open work orders">{A.openWorkOrders}</Row>
              <Row k="Active vendors">{A.vendors}</Row>
              <Row k="Expiring COIs" warn={A.expiringCOIs > 0}>{A.expiringCOIs}</Row>
            </dl>
            <FeedsFrom>CINC bank balances, invoice intake, tickets, vendor compliance</FeedsFrom>
          </Card>
          <Card title="Board officers" action="Message all">
            <ul className="space-y-2 text-sm">
              {BOARD.map(b => (
                <li key={b.role}>
                  <div className="font-medium text-gray-900">{b.name}</div>
                  <div className="text-[11px] text-gray-500">{b.role} · {b.email}</div>
                </li>
              ))}
            </ul>
            <FeedsFrom>CINC board members + board-setup</FeedsFrom>
          </Card>
        </aside>

        {/* Tab content */}
        <section className="space-y-4">
          {tab === 'Overview' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Operating balance" value={money(A.operating)} tone="ok" />
                <Stat label="Open work orders" value={String(A.openWorkOrders)} tone="neutral" />
                <Stat label="Compliance alerts" value={`${A.expiringCOIs}`} tone="warn" sub="expiring/expired COIs" />
              </div>
              <Card title="Needs attention" action="View all">
                <ul className="divide-y divide-gray-100 text-sm">
                  <Alert tone="bad">Hidden Eyes LLC — COI expired 05/2026 (Security vendor on 1 open WO)</Alert>
                  <Alert tone="warn">Testa &amp; Sons — COI expires in 21 days</Alert>
                  <Alert tone="warn">2 invoices awaiting payment in CINC ($5,235.58)</Alert>
                  <Alert tone="neutral">Monthly board report for May not yet sent</Alert>
                </ul>
                <FeedsFrom>vendor compliance + reconciliation + reports status</FeedsFrom>
              </Card>
              <Card title="Recent activity">
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>· AB Electric sent a revised estimate ($4,820) — <span className="text-gray-400">5h ago</span></li>
                  <li>· Work order TKT-2026-0075 created &amp; synced to CINC — <span className="text-gray-400">yesterday</span></li>
                  <li>· Invoice #769602 marked paid in CINC — <span className="text-gray-400">2 days ago</span></li>
                </ul>
                <FeedsFrom>ticket events + invoice + comms log</FeedsFrom>
              </Card>
            </>
          )}

          {tab === 'Board & Owners' && (
            <>
              <Card title="Board members" action="+ Add / sync from CINC">
                <Table head={['Role', 'Name', 'Contact', '']}>
                  {BOARD.map(b => (
                    <tr key={b.role} className="border-t border-gray-100">
                      <Td>{b.role}</Td><Td className="font-medium text-gray-900">{b.name}</Td>
                      <Td className="text-gray-500">{b.email} · {b.phone}</Td>
                      <Td className="text-right"><LinkBtn>Message</LinkBtn></Td>
                    </tr>
                  ))}
                </Table>
                <FeedsFrom>CINC board members · /admin/board-setup</FeedsFrom>
              </Card>
              <Card title="Owners" action="View all 84 →">
                <Table head={['Unit', 'Owner', 'Email', 'Balance']}>
                  <tr className="border-t border-gray-100"><Td>2606</Td><Td>Ticiana C. de Carvalho</Td><Td className="text-gray-500">ticiana@example.net</Td><Td>$0.00</Td></tr>
                  <tr className="border-t border-gray-100"><Td>1402</Td><Td>Robert Hoehn-Saric</Td><Td className="text-gray-500">robert@example.com</Td><Td className="text-red-600">$420.00</Td></tr>
                  <tr className="border-t border-gray-100"><Td>0808</Td><Td>Leonardo O. Amarante</Td><Td className="text-gray-500">leo@example.com</Td><Td>$0.00</Td></tr>
                </Table>
                <FeedsFrom>CINC homeowners / properties · /admin/owners</FeedsFrom>
              </Card>
            </>
          )}

          {tab === 'Vendors' && (
            <Card title="Vendors serving this association" action="+ Email a vendor">
              <Table head={['Vendor', 'Type', 'COI', 'W-9', 'ACH', 'License', '']}>
                {VENDORS.map(v => (
                  <tr key={v.name} className="border-t border-gray-100">
                    <Td className="font-medium text-gray-900">{v.name}</Td>
                    <Td className="text-gray-500">{v.type}</Td>
                    <Td><Pill s={v.coi} /></Td><Td><Pill s={v.w9} /></Td>
                    <Td><Pill s={v.ach} /></Td><Td><Pill s={v.lic} /></Td>
                    <Td className="text-right"><LinkBtn>Request estimate</LinkBtn></Td>
                  </tr>
                ))}
              </Table>
              <FeedsFrom>CINC vendor compliance (COI/W-9/ACH/license) + request-for-estimate</FeedsFrom>
            </Card>
          )}

          {tab === 'Work Orders' && (
            <Card title="Work orders" action="+ New work order">
              <Table head={['Ref', 'Title', 'Vendor', 'Status', 'Due']}>
                {WORKORDERS.map(w => (
                  <tr key={w.ref} className="border-t border-gray-100">
                    <Td className="font-mono text-xs">{w.ref}</Td>
                    <Td className="text-gray-900">{w.title}</Td>
                    <Td className="text-gray-500">{w.vendor}</Td>
                    <Td><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${w.status === 'open' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{w.status}</span></Td>
                    <Td className="text-gray-500">{w.due}</Td>
                  </tr>
                ))}
              </Table>
              <FeedsFrom>tickets (type=work_order) filtered to this association</FeedsFrom>
            </Card>
          )}

          {tab === 'Maintenance' && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Open" value="5" tone="neutral" />
                <Stat label="Overdue" value="1" tone="warn" />
                <Stat label="Completed (30d)" value="7" tone="ok" />
                <Stat label="Cost (30d)" value="$8,207" tone="neutral" />
              </div>

              <CalendarMock />

              <Card title="Preventive maintenance schedule" action="+ Add schedule">
                <Table head={['Task', 'Cadence', 'Vendor', 'Next due', '']}>
                  {PREVENTIVE.map(p => (
                    <tr key={p.name} className="border-t border-gray-100">
                      <Td className="font-medium text-gray-900">{p.name}</Td>
                      <Td className="text-gray-500">{p.cadence}</Td>
                      <Td className="text-gray-500">{p.vendor}</Td>
                      <Td>{p.next}</Td>
                      <Td className="text-right"><LinkBtn>Edit</LinkBtn></Td>
                    </tr>
                  ))}
                </Table>
                <FeedsFrom>NEW: preventive schedules → auto-generate recurring work orders + calendar events</FeedsFrom>
              </Card>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card title="Work orders by category">
                  {BY_CATEGORY.map(c => (
                    <div key={c.c} className="mb-1.5">
                      <div className="flex justify-between text-xs text-gray-600"><span>{c.c}</span><span>{c.n}</span></div>
                      <div className="h-2 rounded bg-gray-100"><div className="h-2 rounded bg-[#f26a1b]" style={{ width: `${(c.n / 8) * 100}%` }} /></div>
                    </div>
                  ))}
                  <FeedsFrom>tickets grouped by work-order type</FeedsFrom>
                </Card>
                <Card title="Vendors with expiring insurance">
                  <ul className="divide-y divide-gray-100 text-sm">
                    {EXPIRING_INS.map(v => (
                      <li key={v.v} className="flex items-center justify-between py-2">
                        <span className="text-gray-900">{v.v}</span>
                        <span className={v.days < 0 ? 'text-red-600' : 'text-amber-600'}>{v.days < 0 ? `expired ${-v.days}d ago` : `in ${v.days} days`}</span>
                      </li>
                    ))}
                  </ul>
                  <FeedsFrom>CINC vendor compliance — COI expiry</FeedsFrom>
                </Card>
              </div>
            </>
          )}

          {tab === 'Projects' && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Active projects" value="3" tone="neutral" />
                <Stat label="In bidding" value="1" tone="warn" />
                <Stat label="Committed budget" value="$276,000" tone="neutral" />
                <Stat label="Spent to date" value="$116,450" tone="ok" />
              </div>
              <Card title="Capital & large projects" action="+ New project">
                <Table head={['Project', 'Status', 'Vendor', 'Budget', 'Spent', 'Progress', 'Target']}>
                  {PROJECTS.map(p => (
                    <tr key={p.name} className="border-t border-gray-100">
                      <Td className="font-medium text-gray-900">{p.name}</Td>
                      <Td><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${PROJ_STATUS[p.status]}`}>{p.status}</span></Td>
                      <Td className="text-gray-500">{p.vendor}</Td>
                      <Td>{money(p.budget)}</Td>
                      <Td>{money(p.spent)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 rounded bg-gray-100"><div className="h-2 rounded bg-[#f26a1b]" style={{ width: `${p.pct}%` }} /></div>
                          <span className="text-[11px] text-gray-500">{p.pct}%</span>
                        </div>
                      </Td>
                      <Td className="text-gray-500">{p.target}</Td>
                    </tr>
                  ))}
                </Table>
                <FeedsFrom>NEW: a project = grouped work orders + budget + board approval; ties into the estimates board report</FeedsFrom>
              </Card>
            </>
          )}

          {tab === 'Inspections' && (
            <Card title="Inspections & compliance certifications" action="+ Add inspection">
              <Table head={['Inspection', 'Last done', 'Next due', 'Status', 'Inspector', '']}>
                {INSPECTIONS.map(it => (
                  <tr key={it.type} className="border-t border-gray-100">
                    <Td className="font-medium text-gray-900">{it.type}</Td>
                    <Td className="text-gray-500">{it.last}</Td>
                    <Td>{it.next}</Td>
                    <Td><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${INSP_STATUS[it.status]}`}>{INSP_LABEL[it.status]}</span></Td>
                    <Td className="text-gray-500">{it.who}</Td>
                    <Td className="text-right"><LinkBtn>Report</LinkBtn></Td>
                  </tr>
                ))}
              </Table>
              <FeedsFrom>NEW: inspection/cert tracking (SB-4D milestone, reserve study, fire, elevator) + deadline alerts → /safety + documents</FeedsFrom>
            </Card>
          )}

          {tab === 'Financials' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Stat label="Operating — Cash 3203" value={money(A.operating)} tone="ok" />
                <Stat label="Reserves" value={money(A.reserve)} tone="ok" />
              </div>
              <Card title="To pay in CINC" action="Open reconciliation →">
                <Table head={['Pay by', 'Vendor', 'Invoice', 'Amount']}>
                  <tr className="border-t border-gray-100"><Td>7/1</Td><Td>Hidden Eyes LLC</Td><Td className="font-mono text-xs">#769602</Td><Td className="text-red-700">$4,823.63</Td></tr>
                  <tr className="border-t border-gray-100"><Td>6/8</Td><Td>Testa &amp; Sons Signs</Td><Td className="font-mono text-xs">#86554</Td><Td className="text-red-700">$411.95</Td></tr>
                </Table>
                <FeedsFrom>reconciliation upcoming payments + invoice intake + forecast/budget</FeedsFrom>
              </Card>
            </>
          )}

          {tab === 'Budget' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Annual budget" value="$324,000" tone="neutral" />
                <Stat label="Actual YTD" value="$223,700" tone="ok" />
                <Stat label="Reserve contribution" value="$60,000 / yr" tone="neutral" />
              </div>
              <Card title="Budget vs actual (YTD)" action="Open in reconciliation →">
                <Table head={['GL category', 'Budget', 'Actual', 'Variance', '']}>
                  {BUDGET.map(b => {
                    const v = b.b - b.a
                    const pct = Math.min(100, (b.a / b.b) * 100)
                    return (
                      <tr key={b.cat} className="border-t border-gray-100">
                        <Td className="text-gray-900">{b.cat}</Td>
                        <Td>{money(b.b)}</Td>
                        <Td>{money(b.a)}</Td>
                        <Td className={v < 0 ? 'text-red-600' : 'text-emerald-700'}>{v < 0 ? '−' : ''}{money(Math.abs(v))}</Td>
                        <Td><div className="h-2 w-24 rounded bg-gray-100"><div className={`h-2 rounded ${b.a > b.b ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} /></div></Td>
                      </tr>
                    )
                  })}
                </Table>
                <FeedsFrom>CINC budget lines + GL actuals + reconciliation</FeedsFrom>
              </Card>
            </>
          )}

          {tab === 'Documents & Compliance' && (
            <Card title="Documents" action="+ Upload">
              <Table head={['Name', 'Category', 'Date', 'Expires']}>
                {DOCS.map(d => (
                  <tr key={d.name} className="border-t border-gray-100">
                    <Td className="text-gray-900">{d.name}</Td>
                    <Td><span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600">{d.cat}</span></Td>
                    <Td className="text-gray-500">{d.date}</Td>
                    <Td className={d.expires ? 'text-gray-700' : 'text-gray-300'}>{d.expires ?? '—'}</Td>
                  </tr>
                ))}
              </Table>
              <FeedsFrom>/cinc-sync/[code]/documents · /insurance · /safety (already built)</FeedsFrom>
            </Card>
          )}

          {tab === 'Communications' && (
            <Card title="Conversations" action="+ New message">
              <div className="text-[11px] text-amber-700 mb-2">★ Mostly net-new — shaped by your RentVine screenshots.</div>
              <ul className="divide-y divide-gray-100">
                {THREADS.map((t, i) => (
                  <li key={i} className="flex items-center gap-3 py-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${t.unread ? 'bg-[#f26a1b]' : 'bg-transparent'}`} />
                    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${t.kind === 'board' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}`}>{t.kind}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900">{t.with}</div>
                      <div className="truncate text-xs text-gray-500">{t.last}</div>
                    </div>
                    <span className="shrink-0 text-[11px] text-gray-400">{t.when}</span>
                  </li>
                ))}
              </ul>
              <FeedsFrom>NEW: vendor + board comms threads (email capture via maia@ + add-on)</FeedsFrom>
            </Card>
          )}

          {tab === 'Reports' && (
            <Card title="Reports" action="Generate monthly report">
              <ul className="divide-y divide-gray-100 text-sm">
                <li className="flex items-center justify-between py-2"><span>May 2026 board report</span><LinkBtn>Generate</LinkBtn></li>
                <li className="flex items-center justify-between py-2"><span>April 2026 board report</span><span className="text-gray-400 text-xs">sent Apr 30</span></li>
                <li className="flex items-center justify-between py-2"><span>March 2026 board report</span><span className="text-gray-400 text-xs">sent Mar 31</span></li>
              </ul>
              <FeedsFrom>/admin/reports/monthly?assoc=LCLUB (already built)</FeedsFrom>
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}

// ── Small presentational helpers ────────────────────────────────────
function Row({ k, children, warn }: { k: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500">{k}</dt>
      <dd className={warn ? 'font-semibold text-amber-600' : 'font-medium text-gray-900'}>{children}</dd>
    </div>
  )
}
function Stat({ label, value, tone, sub }: { label: string; value: string; tone: 'ok' | 'warn' | 'neutral'; sub?: string }) {
  const ring = tone === 'ok' ? 'border-emerald-200' : tone === 'warn' ? 'border-amber-200' : 'border-gray-200'
  return (
    <div className={`rounded-lg border bg-white p-4 ${ring}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}
function Alert({ tone, children }: { tone: 'bad' | 'warn' | 'neutral'; children: React.ReactNode }) {
  const dot = tone === 'bad' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-gray-300'
  return <li className="flex items-center gap-2 py-2"><span className={`h-2 w-2 rounded-full ${dot}`} />{children}</li>
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">{head.map((h, i) => <th key={i} className={`pb-1 font-semibold ${i === head.length - 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  )
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`py-1.5 ${className}`}>{children}</td>
}
function LinkBtn({ children }: { children: React.ReactNode }) {
  return <button className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]">{children}</button>
}
function Pill({ s }: { s: string }) {
  const r = RAG[s] ?? RAG.none
  return <span className="inline-flex items-center gap-1 text-[11px] text-gray-600"><span className={`h-2 w-2 rounded-full ${r.dot}`} />{r.label}</span>
}

// ── Maintenance calendar (3-day / week / month) ─────────────────────
function CalendarMock() {
  const [view, setView] = useState<'3day' | 'week' | 'month'>('week')
  return (
    <Card title="Maintenance calendar" action="+ Schedule preventive task">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-700">June 2026</div>
        <div className="inline-flex overflow-hidden rounded border border-gray-200 text-xs">
          {(['3day', 'week', 'month'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 ${view === v ? 'bg-[#f26a1b] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >{v === '3day' ? '3 days' : v === 'week' ? 'Week' : 'Month'}</button>
          ))}
        </div>
      </div>
      {view === 'month' && <MonthGrid />}
      {view === 'week'  && <DayCols days={WEEK_DAYS} />}
      {view === '3day'  && <DayCols days={THREE_DAYS} wide />}
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-gray-500">
        <Legend k="pool" label="Pool" /><Legend k="land" label="Landscaping" />
        <Legend k="insp" label="Inspection" /><Legend k="safety" label="Safety / Fire" />
        <Legend k="hvac" label="HVAC" /><Legend k="clean" label="Cleaning" />
      </div>
      <FeedsFrom>NEW: preventive schedules + recurring work orders rendered as calendar events</FeedsFrom>
    </Card>
  )
}
function MonthGrid() {
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[10px] uppercase tracking-wide text-gray-400">
        {dow.map(d => <div key={d} className="pb-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded bg-gray-200">
        {MONTH.map((c, i) => (
          <div key={i} className={`min-h-[78px] p-1 ${c.o ? 'bg-gray-50' : 'bg-white'}`}>
            <div className={`text-[11px] ${c.o ? 'text-gray-300' : 'text-gray-500'}`}>{c.d}</div>
            {!c.o && (CAL_EVENTS[c.d] ?? []).slice(0, 2).map((e, j) => (
              <div key={j} className={`mt-0.5 truncate rounded px-1 py-0.5 text-[10px] ${EVK[e.k]}`}>{e.t}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
function DayCols({ days, wide }: { days: readonly (readonly [string, number])[]; wide?: boolean }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
      {days.map(([dowLabel, d]) => (
        <div key={d} className="rounded border border-gray-200">
          <div className="border-b border-gray-100 bg-gray-50 px-2 py-1 text-center text-[11px] text-gray-500">
            {dowLabel} <span className="font-semibold text-gray-800">{d}</span>
          </div>
          <div className={`space-y-1 p-1.5 ${wide ? 'min-h-[160px]' : 'min-h-[120px]'}`}>
            {(CAL_EVENTS[d] ?? []).map((e, i) => (
              <div key={i} className={`rounded px-1.5 py-1 text-[11px] ${EVK[e.k]}`}>{e.t}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
function Legend({ k, label }: { k: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded ${EVK[k].split(' ')[0]}`} />{label}</span>
}
