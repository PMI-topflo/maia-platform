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

const TABS = ['Overview', 'Board & Owners', 'Vendors', 'Work Orders', 'Financials', 'Documents & Compliance', 'Communications', 'Reports'] as const
type Tab = typeof TABS[number]

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
