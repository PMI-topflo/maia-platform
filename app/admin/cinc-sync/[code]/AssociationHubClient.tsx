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
import { useRouter } from 'next/navigation'
import WoComplianceModal from './WoComplianceModal'
import OnboardVendorModal from '@/components/OnboardVendorModal'
import NewWorkOrderModal from './NewWorkOrderModal'
import SyncPreviewClient from './SyncPreviewClient'
import MaintenanceTab from './MaintenanceTab'
import ProjectsTab from './ProjectsTab'
import InspectionsTab from './InspectionsTab'
import ComplianceMatrix from './ComplianceMatrix'
import AssociationUnitDocs from '../../audit/AssociationUnitDocs'
import VendorTradeCell from './VendorTradeCell'

export interface HubBankAccount { description: string; last4: string | null; kind: string; bankBalance: number | null; restricted: boolean }
export interface HubBoardMember { id: string; name: string | null; email: string | null; role: string | null }
export interface HubWorkOrder { id: number; ticket_number: string; subject: string | null; status: string; priority: string; due_at: string | null; payment_state: string | null; cinc_workorder_id: string | null; vendor_docs_requested_at: string | null }
export interface HubBudgetLine { id: string; number: string | null; name: string; budget: number | null; actual: number | null; remaining: number | null }

export interface AssociationHubData {
  code:          string
  name:          string
  units:         number | null
  type:          string | null
  serviceType:   string | null
  ownersCount:   number
  bankAccounts:  HubBankAccount[]
  board:         HubBoardMember[]
  workOrders:    HubWorkOrder[]
  budget:        HubBudgetLine[]
  openWorkOrders: number
  openInvoices:  number
  docCount:      number
  associations:  { code: string; name: string }[]
}

type Rag = 'ok' | 'warn' | 'bad' | 'none'
interface VendorRow { id: number; name: string; trade: string | null; tradeSource: string | null; coi: Rag; w9: Rag; ach: Rag; license: Rag }
const RAG_DOT:   Record<Rag, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', none: 'bg-gray-300' }
const RAG_LABEL: Record<Rag, string> = { ok: 'OK', warn: 'Expiring', bad: 'Expired', none: 'Missing' }
function RagPill({ s }: { s: Rag }) {
  return <span className="inline-flex items-center gap-1 text-[11px] text-gray-600"><span className={`h-2 w-2 rounded-full ${RAG_DOT[s]}`} />{RAG_LABEL[s]}</span>
}

// Service-level chip — FM (full management) / BK (bookkeeping), same as the
// associations directory list.
function ServiceBadge({ s }: { s: string | null }) {
  const n = (s ?? '').toLowerCase()
  if (n.includes('full') || n === 'fm') return <span className="inline-flex rounded border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-emerald-800">FM</span>
  if (n.includes('book') || n.includes('financial') || n === 'bk') return <span className="inline-flex rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-amber-800">BK</span>
  return <span className="font-mono text-[10px] text-gray-300">—</span>
}

const money = (n: number | null | undefined) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800',
  waiting_external: 'bg-blue-100 text-blue-800', resolved: 'bg-slate-100 text-slate-700', closed: 'bg-gray-200 text-gray-600',
}

const TABS = ['Overview', 'Board & Owners', 'Vendors', 'Work Orders', 'Maintenance', 'Projects', 'Inspections', 'Financials', 'Budget', 'Documents & Compliance', 'Reports'] as const
type Tab = typeof TABS[number]

export default function AssociationHubClient({ data }: { data: AssociationHubData }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('Overview')
  const [docScope, setDocScope] = useState<'assoc' | 'unit'>('assoc')
  const [actionsOpen, setActionsOpen] = useState(false)
  const { code } = data
  const bankTotal = data.bankAccounts.reduce((s, a) => s + (a.bankBalance ?? 0), 0)

  // Per-work-order "Add invoice" → opens the vendor-compliance gate (ACH/W-9
  // check) before any upload. The modal owns the upload + doc-request actions.
  const [complianceWoId, setComplianceWoId] = useState<number | null>(null)
  const [woMsg, setWoMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  function addInvoiceToWo(woId: number) { setWoMsg(null); setComplianceWoId(woId) }
  const [showOnboard, setShowOnboard] = useState(false)
  const [showNewWO, setShowNewWO] = useState(false)

  // Vendors tab — lazy-loaded (N×3 CINC calls) on first open, triggered
  // from the tab click (not an effect) so we never setState in an effect.
  const [vendors, setVendors] = useState<VendorRow[] | null>(null)
  const [vendorsLoading, setVendorsLoading] = useState(false)
  const [vendorsErr, setVendorsErr] = useState<string | null>(null)
  const [vendorsTruncated, setVendorsTruncated] = useState(false)
  const [vendorTrade, setVendorTrade] = useState('')   // '' = All types
  function loadVendors() {
    if (vendors !== null || vendorsLoading) return
    setVendorsLoading(true); setVendorsErr(null)
    fetch(`/api/admin/cinc/association-vendors?assoc=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then((d: { vendors?: VendorRow[]; truncated?: boolean; error?: string }) => {
        if (d.error) throw new Error(d.error)
        setVendors(d.vendors ?? []); setVendorsTruncated(!!d.truncated)
      })
      .catch(e => setVendorsErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setVendorsLoading(false))
  }

  function selectTab(t: Tab) {
    setTab(t)
    if (t === 'Vendors') loadVendors()
  }

  const ACTIONS: { label: string; href: string }[] = [
    { label: 'New work order',  href: '/admin/work-orders' },
    { label: 'Add invoice',     href: `/admin/invoices?upload=1&assoc=${code}` },
    { label: 'Reconcile month', href: `/admin/reconciliation?assoc=${code}` },
    { label: 'Monthly report',  href: `/admin/reports/monthly?assoc=${code}` },
    { label: 'Documents',       href: `/admin/cinc-sync/${code}/documents` },
    { label: 'Insurance',       href: `/admin/cinc-sync/${code}/insurance` },
    { label: 'Safety',          href: `/admin/cinc-sync/${code}/safety` },
  ]

  return (
    <div onClick={() => actionsOpen && setActionsOpen(false)}>
      {/* Vendor-compliance gate (ACH/W-9) → invoice upload, per work order. */}
      {complianceWoId != null && (
        <WoComplianceModal
          woId={complianceWoId}
          onClose={() => setComplianceWoId(null)}
          onDone={(m) => { setWoMsg(m); setComplianceWoId(null); router.refresh() }}
        />
      )}
      {showOnboard && <OnboardVendorModal onClose={() => setShowOnboard(false)} />}
      {showNewWO && <NewWorkOrderModal assocCode={code} assocName={data.name} onClose={() => setShowNewWO(false)} />}
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
          {/* At-a-glance service level + scale, same info as the directory list. */}
          <div className="mt-2 flex flex-wrap items-center gap-5 text-xs">
            <span className="inline-flex items-center gap-1.5"><span className="text-[10px] uppercase tracking-wide text-gray-400">Service</span><ServiceBadge s={data.serviceType} /></span>
            <span className="inline-flex items-center gap-1.5"><span className="text-[10px] uppercase tracking-wide text-gray-400">Owners</span><span className="font-semibold text-gray-900 tabular-nums">{data.ownersCount}</span></span>
            <span className="inline-flex items-center gap-1.5"><span className="text-[10px] uppercase tracking-wide text-gray-400">Board</span><span className="font-semibold text-gray-900 tabular-nums">{data.board.length}</span></span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick switch to another association without going back to the list. */}
          <select
            value={code}
            onChange={e => { if (e.target.value && e.target.value !== code) router.push(`/admin/cinc-sync/${e.target.value}`) }}
            title="Switch association"
            className="max-w-[220px] rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {data.associations.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
          </select>
          <Link href={`/admin/reports/monthly?assoc=${code}`} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Run Monthly Report</Link>
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setActionsOpen(o => !o) }} className="rounded bg-[#16a34a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#15803d]">Actions ▾</button>
            {actionsOpen && (
              <div onClick={e => e.stopPropagation()} className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                {ACTIONS.map(a => a.label === 'New work order'
                  ? <button key={a.label} onClick={() => { setActionsOpen(false); setShowNewWO(true) }} className="block w-full px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-50">{a.label}</button>
                  : <Link key={a.label} href={a.href} className="block px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50">{a.label}</Link>)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t} onClick={() => selectTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-[#f26a1b] text-[#f26a1b]' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>{t}</button>
        ))}
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
                {woMsg && (
                  <div className={`mb-3 rounded border px-3 py-2 text-xs ${woMsg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{woMsg.text}</div>
                )}
                {data.workOrders.length === 0 ? <Empty>No work orders for this association.</Empty> : (
                  <WorkOrderTable rows={data.workOrders.slice(0, 6)} showActions onAddInvoice={addInvoiceToWo} />
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

          {tab === 'Vendors' && (() => {
            const trades = Array.from(new Set((vendors ?? []).map(v => v.trade).filter((t): t is string => !!t))).sort((a, b) => a.localeCompare(b))
            const shown = (vendors ?? []).filter(v => !vendorTrade || v.trade === vendorTrade)
            return (
            <Card title="Vendors serving this association">
              <div className="mb-3 flex justify-end">
                <button onClick={() => setShowOnboard(true)} className="rounded bg-[#16a34a] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#15803d]">+ Onboard new vendor</button>
              </div>
              {vendorsLoading && <p className="text-xs text-gray-400">Loading vendor compliance from CINC…</p>}
              {vendorsErr && <p className="text-xs text-red-600">{vendorsErr}</p>}
              {vendors && vendors.length === 0 && !vendorsLoading && <Empty>No vendors on this association in CINC.</Empty>}
              {vendors && vendors.length > 0 && (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Trade</span>
                    <select value={vendorTrade} onChange={e => setVendorTrade(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700">
                      <option value="">All types</option>
                      {trades.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <span className="text-[11px] text-gray-400">{shown.length} of {vendors.length}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
                      <th className="pb-1 text-left font-semibold">Vendor</th>
                      <th className="pb-1 text-left font-semibold">Trade</th>
                      <th className="pb-1 text-left font-semibold">COI</th>
                      <th className="pb-1 text-left font-semibold">W-9</th>
                      <th className="pb-1 text-left font-semibold">ACH</th>
                      <th className="pb-1 text-left font-semibold">License</th>
                    </tr></thead>
                    <tbody>
                      {shown.map(v => (
                        <tr key={v.id} className="border-t border-gray-100">
                          <td className="py-1.5 font-medium text-gray-900">{v.name}</td>
                          <td className="py-1.5 text-gray-600">
                            <VendorTradeCell vendorId={v.id} trade={v.trade} tradeSource={v.tradeSource}
                              onSaved={(trade, source) => setVendors(prev => prev?.map(x => x.id === v.id ? { ...x, trade, tradeSource: source } : x) ?? prev)} />
                          </td>
                          <td className="py-1.5"><RagPill s={v.coi} /></td>
                          <td className="py-1.5"><RagPill s={v.w9} /></td>
                          <td className="py-1.5"><RagPill s={v.ach} /></td>
                          <td className="py-1.5"><RagPill s={v.license} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {vendorsTruncated && <p className="mt-2 text-[11px] text-gray-400">Showing the first 30 vendors.</p>}
            </Card>
          )})()}

          {tab === 'Work Orders' && (
            <Card title="Work orders" action="Open list →" actionHref={`/admin/work-orders?association=${code}`}>
              {woMsg && (
                <div className={`mb-3 rounded border px-3 py-2 text-xs ${woMsg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{woMsg.text}</div>
              )}
              {data.workOrders.length === 0 ? <Empty>No work orders for this association.</Empty> : (
                <WorkOrderTable rows={data.workOrders} showActions onAddInvoice={addInvoiceToWo} />
              )}
            </Card>
          )}

          {tab === 'Maintenance' && <MaintenanceTab assoc={code} openWorkOrders={data.openWorkOrders} />}

          {tab === 'Projects' && <ProjectsTab assoc={code} />}

          {tab === 'Inspections' && <InspectionsTab assoc={code} />}

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

          {tab === 'Budget' && (() => {
            const lines = data.budget.filter(l => (l.budget ?? 0) !== 0 || (l.actual ?? 0) !== 0)
            const totalB = lines.reduce((s, l) => s + (l.budget ?? 0), 0)
            const totalA = lines.reduce((s, l) => s + (l.actual ?? 0), 0)
            return (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Stat label="Annual budget" value={money(totalB)} />
                  <Stat label="Actual YTD" value={money(totalA)} />
                  <Stat label="Remaining" value={money(totalB - totalA)} />
                </div>
                <Card title="Budget vs actual (YTD)" action="Reconciliation →" actionHref={`/admin/reconciliation?assoc=${code}`}>
                  {lines.length === 0 ? <Empty>No budget returned by CINC for this association.</Empty> : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
                        <th className="pb-1 text-left font-semibold">GL category</th>
                        <th className="pb-1 text-right font-semibold">Budget</th>
                        <th className="pb-1 text-right font-semibold">Actual</th>
                        <th className="pb-1 text-right font-semibold">Remaining</th>
                        <th className="pb-1"></th>
                      </tr></thead>
                      <tbody>
                        {lines.map(l => {
                          const b = l.budget ?? 0, a = l.actual ?? 0, rem = l.remaining ?? (b - a)
                          const pct = b > 0 ? Math.min(100, (a / b) * 100) : (a > 0 ? 100 : 0)
                          const over = a > b && b > 0
                          return (
                            <tr key={l.id} className="border-t border-gray-100">
                              <td className="py-1.5 text-gray-900">{l.name}{l.number && <span className="text-gray-400"> · {l.number}</span>}</td>
                              <td className="py-1.5 text-right tabular-nums">{money(l.budget)}</td>
                              <td className="py-1.5 text-right tabular-nums">{money(l.actual)}</td>
                              <td className={`py-1.5 text-right tabular-nums ${rem < 0 ? 'text-red-600' : 'text-gray-700'}`}>{money(rem)}</td>
                              <td className="py-1.5"><div className="h-2 w-24 rounded bg-gray-100"><div className={`h-2 rounded ${over ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} /></div></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </Card>
              </>
            )
          })()}

          {tab === 'Documents & Compliance' && (
            <div className="space-y-4">
              <div className="flex gap-1 border-b border-gray-200">
                <button onClick={() => setDocScope('assoc')} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${docScope === 'assoc' ? 'border-[#f26a1b] text-[#f26a1b]' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>Association documents</button>
                <button onClick={() => setDocScope('unit')} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${docScope === 'unit' ? 'border-[#f26a1b] text-[#f26a1b]' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>Unit / owner documents</button>
              </div>
              {docScope === 'assoc' ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <DocLink href={`/admin/cinc-sync/${code}/documents`} icon="📄" label="Documents" sub={`${data.docCount} on file`} />
                    <DocLink href={`/admin/cinc-sync/${code}/insurance`} icon="🛡" label="Insurance" sub="Policies & COIs" />
                    <DocLink href={`/admin/cinc-sync/${code}/safety`} icon="🏗" label="Safety" sub="Milestone / SB-4D" />
                  </div>
                  <ComplianceMatrix assocCode={code} />
                </>
              ) : (
                <AssociationUnitDocs assocCode={code} />
              )}
            </div>
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
function PaymentBadge({ s }: { s: string | null }) {
  if (s === 'paid')              return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-800">✓ Paid</span>
  if (s === 'ready_for_payment') return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-violet-100 text-violet-800">Ready for payment</span>
  return <span className="text-gray-300">—</span>
}

function WorkOrderTable({ rows, showActions, onAddInvoice }: {
  rows: HubWorkOrder[]
  showActions?: boolean
  onAddInvoice?: (woId: number) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400">
        <th className="pb-1 text-left font-semibold">Ref</th>
        <th className="pb-1 text-left font-semibold">Subject</th>
        <th className="pb-1 text-left font-semibold">Status</th>
        <th className="pb-1 text-left font-semibold">Payment</th>
        <th className="pb-1 text-left font-semibold">Due</th>
        {showActions && <th className="pb-1 text-right font-semibold"></th>}
      </tr></thead>
      <tbody>
        {rows.map(w => {
          const paid = w.payment_state === 'paid'
          return (
          <tr key={w.id} className="border-t border-gray-100">
            <td className="py-1.5"><Link href={`/admin/tickets/${w.id}`} className="font-mono text-xs text-[#f26a1b] hover:underline">{w.ticket_number}</Link></td>
            <td className="py-1.5 text-gray-900">{w.subject ?? '—'}</td>
            <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLES[w.status] ?? 'bg-gray-100 text-gray-600'}`}>{w.status.replace('_', ' ')}</span></td>
            <td className="py-1.5">
              <PaymentBadge s={w.payment_state} />
              {w.vendor_docs_requested_at && (
                <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800" title="ACH/W-9 requested from the vendor — follow up if not received">⚠ Awaiting ACH/W-9</span>
              )}
            </td>
            <td className="py-1.5 text-gray-500">{w.due_at ? new Date(w.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
            {showActions && (
              <td className="py-1.5 text-right">
                {paid ? (
                  <span className="text-[11px] text-gray-400">paid</span>
                ) : (
                  <button
                    onClick={() => onAddInvoice?.(w.id)}
                    title="Add the vendor's invoice. MAIA first checks the vendor's ACH/W-9 on file in CINC, then links the invoice to this WO and sends it to review."
                    className="rounded border border-[#16a34a] px-2 py-1 text-[11px] font-medium text-[#16a34a] hover:bg-emerald-50"
                  >
                    {w.payment_state === 'ready_for_payment' ? '+ Add another invoice' : '+ Add invoice'}
                  </button>
                )}
              </td>
            )}
          </tr>
        )})}
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
