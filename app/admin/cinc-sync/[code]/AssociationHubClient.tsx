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
import { associationPortalPath } from '@/lib/association-portal'

export interface HubBankAccount { description: string; last4: string | null; kind: string; bankBalance: number | null; restricted: boolean }
export interface HubBoardMember { id: string; name: string | null; email: string | null; role: string | null }
export interface HubWorkOrder { id: number; ticket_number: string; subject: string | null; status: string; priority: string; due_at: string | null; payment_state: string | null; cinc_workorder_id: string | null; vendor_docs_requested_at: string | null }
export interface HubBudgetLine { id: string; number: string | null; name: string; budget: number | null; actual: number | null; remaining: number | null }

export interface AssociationHubData {
  code:          string
  name:          string
  units:         number | null
  type:          string | null
  statute:       string | null
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
  // MAIA-only classification + identity fields — nothing sets these after
  // /api/admin/cinc-sync/onboard creates the row (it deliberately leaves
  // them null for staff to fill in), and until now there was no UI to do
  // that. See the "Association Details" card below.
  principalAddress:     string | null
  city:                 string | null
  state:                string | null
  zip:                  string | null
  sunbizDocumentNumber: string | null
  feiEinNumber:         string | null
  sunbizStatus:         string | null
  dateFiled:            string | null
  publicWebsiteUrl:     string | null
  // Onboarding-checklist status for the other per-association setup areas —
  // each already has its own dedicated page; this just surfaces whether
  // they've been touched yet, with a link to go do it.
  requiredSignatures:        number | null
  hasApprovalLetterTemplate: boolean
  applicationRulesCount:     number
  documentRequirementsCount: number
  recurringServicesCount:    number
  insurancePoliciesCount:    number
}

// Friendly labels for the association_type stored in the associations table
// (condo / hoa / coop / commercial). Falls back to the raw value.
const TYPE_LABEL: Record<string, string> = {
  condo: 'Condominium', hoa: 'HOA', coop: 'Co-op', 'co-op': 'Co-op', commercial: 'Commercial',
  commercial_condo: 'Commercial Condo', master_hoa: 'Master HOA',
}
const typeLabel = (t: string | null) => t ? (TYPE_LABEL[t.toLowerCase()] ?? t) : null

// Fixed option sets — matches the values already in use across the other
// 25 associations (see the associations table), so a new one stays consistent.
const ASSOC_TYPES  = ['condo', 'hoa', 'coop', 'commercial_condo', 'master_hoa'] as const
const SERVICE_TYPES_OPTS = ['full management', 'bookkeeping'] as const
const STATUTES      = ['Chapter 718', 'Chapter 719', 'Chapter 720'] as const

type Rag = 'ok' | 'warn' | 'bad' | 'none'
// CINC web app — deep link for staff who set the vendor-association account up
// natively in CINC (CINC's API is read-only for that linkage).
const CINC_WEB_URL = 'https://pmitfp.cincsys.com'

interface VendorRow { id: number; name: string; trade: string | null; tradeSource: string | null; linked?: 'cinc' | 'maia' | null; coi: Rag; w9: Rag; ach: Rag; license: Rag }
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
  // The public resident portal — the page unit owners log into and the general
  // public sees (then identifies / registers). Same page the /[slug] router serves.
  const portalPath = associationPortalPath(code)

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
  const [showLinkVendor, setShowLinkVendor] = useState(false)
  function loadVendors(force = false) {
    if (!force && (vendors !== null || vendorsLoading)) return
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

  // Tag / untag a vendor as serving THIS association (MAIA-local link).
  async function toggleHubVendorLink(vendorId: number, vendorName: string, link: boolean) {
    try {
      if (link) {
        await fetch('/api/admin/personas/vendor-links', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assoc: code, vendorId, vendorName }),
        })
      } else {
        await fetch(`/api/admin/personas/vendor-links?assoc=${code}&vendorId=${vendorId}`, { method: 'DELETE' })
      }
    } finally {
      loadVendors(true)
    }
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
      {showLinkVendor && (
        <LinkVendorModal
          assocCode={code} assocName={data.name}
          onClose={() => setShowLinkVendor(false)}
          onLinked={() => { setShowLinkVendor(false); loadVendors(true) }}
        />
      )}
      {/* Header */}
      <div className="mb-1 text-xs text-gray-400"><Link href="/admin/cinc-sync" className="hover:text-[#f26a1b]">Associations</Link> / {data.name}</div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{data.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="font-mono rounded bg-gray-100 px-1.5 py-0.5">{code}</span>
            {data.type && <span className="rounded bg-[#fff4ee] px-1.5 py-0.5 font-medium text-[#c2410c]">{typeLabel(data.type)}</span>}
            {data.statute && <span>· {data.statute}</span>}
            {data.units != null && <span>· {data.units} units</span>}
            {portalPath && (
              <a href={`${portalPath}?preview=owner`} target="_blank" rel="noopener noreferrer" className="font-medium text-[#f26a1b] hover:underline" title="Preview the resident portal as a logged-in unit owner">🌐 Resident portal ↗</a>
            )}
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
      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t} onClick={() => selectTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-[#f26a1b] text-[#f26a1b]' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>{t}</button>
        ))}
        {/* Preview the resident portal the way owners / visitors actually see
            it (staff normally only see their own view). Opens in a new tab. */}
        {portalPath && (
          <span className="-mb-px ml-auto flex flex-wrap items-center gap-1 px-1 py-2 text-sm">
            <span className="text-xs text-gray-400">🌐 View portal as:</span>
            <a href={`${portalPath}?preview=owner`} target="_blank" rel="noopener noreferrer"
              className="rounded px-2 py-0.5 text-xs font-medium text-[#f26a1b] hover:bg-[#fff4ee]"
              title="See the portal as a logged-in unit owner">Unit owner ↗</a>
            <a href={`${portalPath}?preview=board`} target="_blank" rel="noopener noreferrer"
              className="rounded px-2 py-0.5 text-xs font-medium text-[#f26a1b] hover:bg-[#fff4ee]"
              title="See the portal as a board member">Board ↗</a>
            <a href={`${portalPath}?preview=onsite_manager`} target="_blank" rel="noopener noreferrer"
              className="rounded px-2 py-0.5 text-xs font-medium text-[#f26a1b] hover:bg-[#fff4ee]"
              title="See the portal as an onsite (non-staff) manager">Onsite mgr ↗</a>
            <a href={`${portalPath}?preview=visitor`} target="_blank" rel="noopener noreferrer"
              className="rounded px-2 py-0.5 text-xs font-medium text-[#f26a1b] hover:bg-[#fff4ee]"
              title="See the portal as a public visitor (login screen)">Visitor ↗</a>
          </span>
        )}
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
          <AssociationDetailsCard data={data} onSaved={() => router.refresh()} />
          <OnboardingChecklistCard data={data} onOpenTab={selectTab} />
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
                  {portalPath && <a href={`${portalPath}?preview=owner`} target="_blank" rel="noopener noreferrer" className="rounded border border-gray-200 px-3 py-1.5 text-gray-700 hover:border-[#f26a1b] hover:text-[#f26a1b]">🌐 Resident portal ↗</a>}
                  <button onClick={() => selectTab('Board & Owners')} className="rounded border border-gray-200 px-3 py-1.5 text-gray-700 hover:border-[#f26a1b] hover:text-[#f26a1b]">👥 Unit owners &amp; CINC sync</button>
                  <QuickLink href={`/admin/cinc-sync/${code}/documents`}>📄 Documents (view &amp; upload)</QuickLink>
                  <QuickLink href={`/admin/reports/monthly?assoc=${code}`}>📊 Monthly report</QuickLink>
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <a href={CINC_WEB_URL} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-[#f26a1b] hover:underline" title="Set the vendor's association account up natively in CINC">Set up in CINC ↗</a>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowLinkVendor(true)} className="rounded border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">+ Link a vendor</button>
                  <button onClick={() => setShowOnboard(true)} className="rounded bg-[#16a34a] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#15803d]">+ Onboard new vendor</button>
                </div>
              </div>
              {vendorsLoading && <p className="text-xs text-gray-400">Loading vendor compliance from CINC…</p>}
              {vendorsErr && <p className="text-xs text-red-600">{vendorsErr}</p>}
              {vendors && vendors.length === 0 && !vendorsLoading && <Empty>No vendors linked to this association yet. Use <span className="font-medium text-emerald-700">+ Link a vendor</span> to tag the ones that serve it.</Empty>}
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
                      <th className="pb-1 text-right font-semibold">Link</th>
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
                          <td className="py-1.5 text-right">
                            {v.linked === 'cinc'
                              ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700" title="Linked via CINC's Vendor-Association account">in CINC</span>
                              : v.linked === 'maia'
                                ? <button onClick={() => toggleHubVendorLink(v.id, v.name, false)} className="text-[11px] font-medium text-gray-500 hover:text-red-600 hover:underline" title="Remove this MAIA link">✓ Linked · Unlink</button>
                                : <span className="text-[11px] text-gray-300">—</span>}
                          </td>
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

// Association-level identity fields that /api/admin/cinc-sync/onboard leaves
// null on purpose ("staff fill in afterwards") — there was previously no
// screen anywhere in MAIA that actually let staff do that. Shown as a
// compact status card; editing happens in AssociationDetailsModal.
const DETAIL_FIELD_COUNT = 9   // type, serviceType, statute, address, city, state, zip, sunbizDocumentNumber, feiEinNumber (dateFiled/sunbizStatus/website are extra credit, not counted toward "missing")

function AssociationDetailsCard({ data, onSaved }: { data: AssociationHubData; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const filled = [data.type, data.serviceType, data.statute, data.principalAddress, data.city, data.state, data.zip, data.sunbizDocumentNumber, data.feiEinNumber].filter(Boolean).length
  const missing = DETAIL_FIELD_COUNT - filled
  return (
    <>
      <Card title="Association Details">
        {missing > 0 && (
          <div className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800">
            ⚠ {missing} setup field{missing === 1 ? '' : 's'} missing
          </div>
        )}
        <dl className="space-y-1.5 text-sm">
          <Row k="Type">{typeLabel(data.type) ?? <span className="text-gray-300">—</span>}</Row>
          <Row k="Service">{data.serviceType ?? <span className="text-gray-300">—</span>}</Row>
          <Row k="Statute">{data.statute ?? <span className="text-gray-300">—</span>}</Row>
          <Row k="Address">{data.principalAddress ? `${data.principalAddress}${data.city ? `, ${data.city}` : ''}` : <span className="text-gray-300">—</span>}</Row>
          <Row k="Sunbiz #">{data.sunbizDocumentNumber ?? <span className="text-gray-300">—</span>}</Row>
        </dl>
        <button onClick={() => setOpen(true)} className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:border-[#f26a1b] hover:text-[#f26a1b]">Edit details</button>
      </Card>
      {open && <AssociationDetailsModal data={data} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved() }} />}
    </>
  )
}

// The rest of a new association's setup, beyond the associations-table
// fields above — each item already has its own dedicated page; this just
// surfaces whether it's been touched yet and links straight to it.
function OnboardingChecklistCard({ data, onOpenTab }: { data: AssociationHubData; onOpenTab: (t: Tab) => void }) {
  const required: { label: string; done: boolean; onClick: () => void }[] = [
    { label: 'Board & Owners synced',    done: data.ownersCount > 0 && data.board.length > 0, onClick: () => onOpenTab('Board & Owners') },
    { label: 'Governing documents',       done: data.docCount > 0,                             onClick: () => onOpenTab('Documents & Compliance') },
    { label: 'Board approval signatures', done: data.requiredSignatures != null,                onClick: () => window.open('/admin/board-setup', '_blank') },
  ]
  const optional: { label: string; done: boolean; note: string; onClick: () => void }[] = [
    { label: 'Application rules',      done: data.applicationRulesCount > 0,     note: data.applicationRulesCount > 0 ? `${data.applicationRulesCount} set` : 'none — defaults apply', onClick: () => window.open('/admin/association-document-setup', '_blank') },
    { label: 'Custom doc requirements', done: data.documentRequirementsCount > 0, note: data.documentRequirementsCount > 0 ? `${data.documentRequirementsCount} set` : 'none — defaults apply', onClick: () => window.open('/admin/association-document-setup', '_blank') },
    { label: 'Recurring vendors',       done: data.recurringServicesCount > 0,    note: data.recurringServicesCount > 0 ? `${data.recurringServicesCount} active` : 'none configured', onClick: () => window.open(`/admin/recurring-services?assoc=${data.code}`, '_blank') },
    { label: "Association's insurance", done: data.insurancePoliciesCount > 0,    note: data.insurancePoliciesCount > 0 ? `${data.insurancePoliciesCount} on file` : 'none on file', onClick: () => window.open(`/admin/cinc-sync/${data.code}/insurance`, '_blank') },
    { label: 'Vendors linked',          done: false,                             note: 'see Vendors tab', onClick: () => onOpenTab('Vendors') },
  ]
  return (
    <Card title="Onboarding Checklist">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Required</div>
      <ul className="mb-3 space-y-1 text-sm">
        {required.map(r => (
          <li key={r.label}>
            <button onClick={r.onClick} className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-50">
              <span className="flex items-center gap-1.5">
                <span className={r.done ? 'text-emerald-600' : 'text-gray-300'}>{r.done ? '✓' : '○'}</span>
                <span className={r.done ? 'text-gray-700' : 'text-gray-500'}>{r.label}</span>
              </span>
              <span className="text-[10px] text-gray-300">→</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Optional / as needed</div>
      <ul className="space-y-1 text-sm">
        {optional.map(o => (
          <li key={o.label}>
            <button onClick={o.onClick} className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-50">
              <span className="flex items-center gap-1.5">
                <span className={o.done ? 'text-emerald-600' : 'text-gray-300'}>{o.done ? '✓' : '—'}</span>
                <span className="text-gray-600">{o.label}</span>
              </span>
              <span className="text-[10px] text-gray-400">{o.note} →</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function AssociationDetailsModal({ data, onClose, onSaved }: { data: AssociationHubData; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    association_type:       data.type ?? '',
    service_type:            data.serviceType ?? '',
    florida_statute:         data.statute ?? '',
    principal_address:       data.principalAddress ?? '',
    city:                    data.city ?? '',
    state:                   data.state ?? 'FL',
    zip:                     data.zip ?? '',
    sunbiz_document_number:  data.sunbizDocumentNumber ?? '',
    fei_ein_number:          data.feiEinNumber ?? '',
    sunbiz_status:           data.sunbizStatus ?? '',
    date_filed:              data.dateFiled ?? '',
    public_website_url:      data.publicWebsiteUrl ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(k: K, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/admin/associations/${data.code}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'Save failed')
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6">
      <div onClick={e => e.stopPropagation()} className="my-8 w-full max-w-lg rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">Association details — {data.name}</div>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {error && <div className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">⚠ {error}</div>}

          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Classification</div>
            <div className="grid grid-cols-2 gap-2">
              <LabeledSelect label="Type" value={form.association_type} onChange={v => set('association_type', v)} options={ASSOC_TYPES.map(t => [t, typeLabel(t) ?? t])} />
              <LabeledSelect label="Service" value={form.service_type} onChange={v => set('service_type', v)} options={SERVICE_TYPES_OPTS.map(s => [s, s])} />
              <LabeledSelect label="Statute" value={form.florida_statute} onChange={v => set('florida_statute', v)} options={STATUTES.map(s => [s, s])} />
              <LabeledInput label="Website" value={form.public_website_url} onChange={v => set('public_website_url', v)} placeholder="https://…" />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Address <span className="normal-case text-gray-400">— the actual property address, NOT a registered agent/mailing address. Used for Checkr background-check property lookup + lease matching on /apply.</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-4"><LabeledInput label="Street" value={form.principal_address} onChange={v => set('principal_address', v)} /></div>
              <div className="col-span-2"><LabeledInput label="City" value={form.city} onChange={v => set('city', v)} /></div>
              <LabeledInput label="State" value={form.state} onChange={v => set('state', v.toUpperCase().slice(0, 2))} />
              <LabeledInput label="Zip" value={form.zip} onChange={v => set('zip', v)} />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Sunbiz (Florida Division of Corporations)</div>
            <div className="grid grid-cols-2 gap-2">
              <LabeledInput label="Document #" value={form.sunbiz_document_number} onChange={v => set('sunbiz_document_number', v)} />
              <LabeledInput label="FEI/EIN #" value={form.fei_ein_number} onChange={v => set('fei_ein_number', v)} />
              <LabeledInput label="Status" value={form.sunbiz_status} onChange={v => set('sunbiz_status', v)} placeholder="ACTIVE" />
              <LabeledInput label="Date filed" value={form.date_filed} onChange={v => set('date_filed', v)} placeholder="MM/DD/YYYY" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded bg-[#16a34a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#15803d] disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function LabeledInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
    </label>
  )
}
function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
        <option value="">— select —</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

interface VendorMatch { vendorId: number; name: string; dba: string | null; email: string | null; phone: string | null; address: string | null }

/** Search ALL CINC vendors and tag the chosen one as serving this association
 *  (a MAIA-local link — CINC has no write API for the association account). */
function LinkVendorModal({ assocCode, assocName, onClose, onLinked }: { assocCode: string; assocName: string; onClose: () => void; onLinked: () => void }) {
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState<VendorMatch[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [linkingId, setLinkingId] = useState<number | null>(null)

  // Live search across the whole CINC catalog.
  function onChange(v: string) {
    setQ(v)
    if (v.trim().length < 2) { setMatches(null); return }
    setSearching(true)
    fetch('/api/admin/vendors/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'search', q: v.trim() }) })
      .then(r => r.json())
      .then((d: { matches?: VendorMatch[] }) => setMatches(d.matches ?? []))
      .catch(() => setMatches([]))
      .finally(() => setSearching(false))
  }

  async function link(m: VendorMatch) {
    setLinkingId(m.vendorId)
    try {
      await fetch('/api/admin/personas/vendor-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assoc: assocCode, vendorId: m.vendorId, vendorName: m.name }),
      })
      onLinked()
    } finally { setLinkingId(null) }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-6">
      <div onClick={e => e.stopPropagation()} className="mt-16 w-full max-w-lg rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">Link a vendor to {assocName}</div>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>
        <div className="p-4">
          <input autoFocus value={q} onChange={e => onChange(e.target.value)} placeholder="Search CINC vendors by name, DBA, email, phone…" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          <div className="mt-3 max-h-80 space-y-1 overflow-auto">
            {searching && <p className="text-xs text-gray-400">Searching CINC…</p>}
            {matches && matches.length === 0 && !searching && <p className="text-xs text-gray-400">No matching vendors.</p>}
            {(matches ?? []).map(m => (
              <div key={m.vendorId} className="flex items-center justify-between rounded border border-gray-100 px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900">{m.name}{m.dba ? ` (dba ${m.dba})` : ''}</div>
                  <div className="truncate text-[11px] text-gray-400">{[m.email, m.phone, m.address].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <button onClick={() => link(m)} disabled={linkingId === m.vendorId} className="ml-2 shrink-0 rounded bg-[#16a34a] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#15803d] disabled:opacity-50">{linkingId === m.vendorId ? 'Linking…' : 'Link'}</button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">Tags the vendor as serving {assocCode} in MAIA. To set the account up in CINC itself, use <a href={CINC_WEB_URL} target="_blank" rel="noopener noreferrer" className="text-[#f26a1b] hover:underline">Set up in CINC ↗</a>.</p>
        </div>
      </div>
    </div>
  )
}
