'use client'

// =====================================================================
// AssociationHubClient.tsx
// The real per-association hub — header + Actions menu + identity rail +
// tabs, wired to live data passed from the server page. Tabs whose data
// already exists are wired here; Maintenance/Projects/Inspections/etc.
// (net-new) are stubbed with a "coming soon" note for now.
// =====================================================================

import Link from 'next/link'
import { useState } from 'react'
import SyncPreviewClient from './SyncPreviewClient'

export interface HubBankAccount { description: string; last4: string | null; kind: string; bankBalance: number | null; restricted: boolean }
export interface HubBoardMember { id: string; name: string | null; email: string | null; role: string | null }
export interface HubWorkOrder { id: number; ticket_number: string; subject: string | null; status: string; priority: string; due_at: string | null }

export interface AssociationHubData {
  code:          string
  name:          string
  units:         number | null
  type:          string | null
  bankAccounts:  HubBankAccount[]
  board:         HubBoardMember[]
  workOrders:    HubWorkOrder[]
  openWorkOrders: number
  openInvoices:  number
  docCount:      number
}

const money = (n: number | null | undefined) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800',
  waiting_external: 'bg-blue-100 text-blue-800', resolved: 'bg-slate-100 text-slate-700', closed: 'bg-gray-200 text-gray-600',
}

const TABS = ['Overview', 'Board & Owners', 'Work Orders', 'Financials', 'Documents & Compliance', 'Reports'] as const
type Tab = typeof TABS[number]

export default function AssociationHubClient({ data }: { data: AssociationHubData }) {
  const [tab, setTab] = useState<Tab>('Overview')
  const [actionsOpen, setActionsOpen] = useState(false)
  const { code } = data
  const bankTotal = data.bankAccounts.reduce((s, a) => s + (a.bankBalance ?? 0), 0)

  const ACTIONS: { label: string; href: string }[] = [
    { label: 'New work order',  href: '/admin/work-orders' },
    { label: 'Add invoice',     href: '/admin/invoices' },
    { label: 'Reconcile month', href: `/admin/reconciliation?assoc=${code}` },
    { label: 'Monthly report',  href: `/admin/reports/monthly?assoc=${code}` },
    { label: 'Documents',       href: `/admin/cinc-sync/${code}/documents` },
    { label: 'Insurance',       href: `/admin/cinc-sync/${code}/insurance` },
    { label: 'Safety',          href: `/admin/cinc-sync/${code}/safety` },
  ]

  return (
    <div onClick={() => actionsOpen && setActionsOpen(false)}>
      {/* Header */}
      <div className="mb-1 text-xs text-gray-400"><Link href="/admin/cinc-sync" className="hover:text-[#f26a1b]">Associations</Link> / {data.name}</div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{data.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="font-mono rounded bg-gray-100 px-1.5 py-0.5">{code}</span>
            {data.type && <span>· {data.type}</span>}
            {data.units != null && <span>· {data.units} units</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/reports/monthly?assoc=${code}`} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Run Monthly Report</Link>
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setActionsOpen(o => !o) }} className="rounded bg-[#16a34a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#15803d]">Actions ▾</button>
            {actionsOpen && (
              <div onClick={e => e.stopPropagation()} className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                {ACTIONS.map(a => <Link key={a.label} href={a.href} className="block px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50">{a.label}</Link>)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-[#f26a1b] text-[#f26a1b]' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>{t}</button>
        ))}
        <span className="ml-2 self-center text-[11px] text-gray-300">Maintenance · Projects · Inspections · Budget — coming next</span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        {/* Identity rail */}
        <aside className="space-y-4">
          <Card title="Snapshot">
            <dl className="space-y-1.5 text-sm">
              <Row k="Operating + reserves">{money(bankTotal)}</Row>
              <Row k="Bank accounts">{data.bankAccounts.length}</Row>
              <Row k="Open work orders">{data.openWorkOrders}</Row>
              <Row k="Open invoice drafts">{data.openInvoices}</Row>
              <Row k="Documents on file">{data.docCount}</Row>
              <Row k="Board members">{data.board.length}</Row>
            </dl>
          </Card>
          <Card title="Board officers" action={data.board.length ? undefined : undefined}>
            {data.board.length === 0 ? (
              <p className="text-xs text-gray-400">No board members on file. Import them in the Board &amp; Owners tab.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.board.slice(0, 6).map(b => (
                  <li key={b.id}>
                    <div className="font-medium text-gray-900">{b.name ?? '—'}</div>
                    <div className="text-[11px] text-gray-500">{[b.role, b.email].filter(Boolean).join(' · ') || '—'}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>

        {/* Tab content */}
        <section className="space-y-4">
          {tab === 'Overview' && (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Bank balance" value={money(bankTotal)} />
                <Stat label="Open work orders" value={String(data.openWorkOrders)} />
                <Stat label="Open invoices" value={String(data.openInvoices)} />
                <Stat label="Documents" value={String(data.docCount)} />
              </div>
              <Card title="Recent work orders" action="View all →" actionHref={`/admin/work-orders?association=${code}`}>
                {data.workOrders.length === 0 ? <Empty>No work orders for this association.</Empty> : (
                  <WorkOrderTable rows={data.workOrders.slice(0, 6)} />
                )}
              </Card>
              <Card title="Quick links">
                <div className="flex flex-wrap gap-2 text-sm">
                  <QuickLink href={`/admin/reports/monthly?assoc=${code}`}>📊 Monthly report</QuickLink>
                  <QuickLink href={`/admin/cinc-sync/${code}/documents`}>📄 Documents</QuickLink>
                  <QuickLink href={`/admin/cinc-sync/${code}/insurance`}>🛡 Insurance</QuickLink>
                  <QuickLink href={`/admin/cinc-sync/${code}/safety`}>🏗 Safety</QuickLink>
                  <QuickLink href={`/admin/reconciliation?assoc=${code}`}>💵 Reconciliation</QuickLink>
                </div>
              </Card>
            </>
          )}

          {tab === 'Board & Owners' && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <SyncPreviewClient assocCode={code} />
            </div>
          )}

          {tab === 'Work Orders' && (
            <Card title="Work orders" action="Open list →" actionHref={`/admin/work-orders?association=${code}`}>
              {data.workOrders.length === 0 ? <Empty>No work orders for this association.</Empty> : <WorkOrderTable rows={data.workOrders} />}
            </Card>
          )}

          {tab === 'Financials' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Stat label="Total bank balance" value={money(bankTotal)} />
                <Stat label="Open invoice drafts" value={String(data.openInvoices)} />
              </div>
              <Card title="Bank accounts" action="Reconciliation →" actionHref={`/admin/reconciliation?assoc=${code}`}>
                {data.bankAccounts.length === 0 ? <Empty>No bank accounts returned by CINC.</Empty> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400"><th className="pb-1 text-left font-semibold">Account</th><th className="pb-1 text-left font-semibold">Kind</th><th className="pb-1 text-right font-semibold">Balance</th></tr></thead>
                    <tbody>
                      {data.bankAccounts.map((a, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="py-1.5 text-gray-900">{a.description}{a.last4 && <span className="text-gray-400"> ····{a.last4}</span>}</td>
                          <td className="py-1.5 text-gray-500">{a.kind}{a.restricted && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">restricted</span>}</td>
                          <td className="py-1.5 text-right tabular-nums text-gray-900">{money(a.bankBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}

          {tab === 'Documents & Compliance' && (
            <Card title="Documents & compliance">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <DocLink href={`/admin/cinc-sync/${code}/documents`} icon="📄" label="Documents" sub={`${data.docCount} on file`} />
                <DocLink href={`/admin/cinc-sync/${code}/insurance`} icon="🛡" label="Insurance" sub="Policies & COIs" />
                <DocLink href={`/admin/cinc-sync/${code}/safety`} icon="🏗" label="Safety" sub="Milestone / SB-4D" />
              </div>
            </Card>
          )}

          {tab === 'Reports' && (
            <Card title="Reports">
              <Link href={`/admin/reports/monthly?assoc=${code}`} className="inline-block rounded bg-[#f26a1b] px-3 py-2 text-sm font-medium text-white hover:bg-[#d85a14]">Open monthly board report →</Link>
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────
function WorkOrderTable({ rows }: { rows: HubWorkOrder[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400"><th className="pb-1 text-left font-semibold">Ref</th><th className="pb-1 text-left font-semibold">Subject</th><th className="pb-1 text-left font-semibold">Status</th><th className="pb-1 text-left font-semibold">Due</th></tr></thead>
      <tbody>
        {rows.map(w => (
          <tr key={w.id} className="border-t border-gray-100">
            <td className="py-1.5"><Link href={`/admin/tickets/${w.id}`} className="font-mono text-xs text-[#f26a1b] hover:underline">{w.ticket_number}</Link></td>
            <td className="py-1.5 text-gray-900">{w.subject ?? '—'}</td>
            <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLES[w.status] ?? 'bg-gray-100 text-gray-600'}`}>{w.status.replace('_', ' ')}</span></td>
            <td className="py-1.5 text-gray-500">{w.due_at ? new Date(w.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
function Card({ title, action, actionHref, children }: { title: string; action?: string; actionHref?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {action && actionHref && <Link href={actionHref} className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14]">{action}</Link>}
      </div>
      {children}
    </div>
  )
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-xl font-semibold text-gray-900">{value}</div></div>
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between"><dt className="text-gray-500">{k}</dt><dd className="font-medium text-gray-900">{children}</dd></div>
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="text-xs text-gray-400">{children}</p> }
function QuickLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="rounded border border-gray-200 px-3 py-1.5 text-gray-700 hover:border-[#f26a1b] hover:text-[#f26a1b]">{children}</Link>
}
function DocLink({ href, icon, label, sub }: { href: string; icon: string; label: string; sub: string }) {
  return (
    <Link href={href} className="rounded-lg border border-gray-200 p-4 hover:border-[#f26a1b]">
      <div className="text-2xl">{icon}</div>
      <div className="mt-1 text-sm font-medium text-gray-900">{label}</div>
      <div className="text-[11px] text-gray-500">{sub}</div>
    </Link>
  )
}
