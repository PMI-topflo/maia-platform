'use client'

// =====================================================================
// AssociationHubShellMock.tsx
// DESIGN MOCKUP of a RentVine-style app shell: a collapsible LEFT
// SIDEBAR (menus + submenus) covering every admin page, with the
// Association Hub rendered in the content area. Static — no wiring.
// =====================================================================

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react'
import AssociationHubMockup from './AssociationHubMockup'

type NavItem = { label: string; icon?: string; active?: boolean }
type NavNode =
  | { type: 'item'; label: string; icon: string; active?: boolean }
  | { type: 'group'; label: string; icon: string; items: NavItem[] }

const NAV: NavNode[] = [
  { type: 'item', label: 'Dashboard', icon: '▦' },
  { type: 'group', label: 'Operations', icon: '🛠', items: [
    { label: 'Tickets' }, { label: 'Work Orders' }, { label: 'Recurring Services' }, { label: 'Communications' },
  ] },
  { type: 'group', label: 'Associations', icon: '🏢', items: [
    { label: 'Association Hub', active: true }, { label: 'Owners' }, { label: 'Board Setup' },
    { label: 'Ownership History' }, { label: 'Tenancy History' },
  ] },
  { type: 'group', label: 'Accounting', icon: '$', items: [
    { label: 'Invoices' }, { label: 'Reconciliation' }, { label: 'Monthly Report' }, { label: 'Budget' },
  ] },
  { type: 'group', label: 'Leasing', icon: '📝', items: [
    { label: 'Applications' }, { label: 'Registrations' }, { label: 'Approvals' },
  ] },
  { type: 'group', label: 'Tools', icon: '⚙', items: [
    { label: 'Staff Performance' }, { label: 'Audit' }, { label: 'Login History' },
    { label: 'Sunbiz' }, { label: 'Ideas' }, { label: 'Skills' }, { label: 'Tools' },
  ] },
  { type: 'item', label: 'Help', icon: '?' },
]

export default function AssociationHubShellMock() {
  const [open, setOpen] = useState<Record<string, boolean>>({ Operations: true, Associations: true, Accounting: true })

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f9fafb', fontFamily: 'var(--font-body)' }}>
      {/* ── Left sidebar ─────────────────────────────────────────── */}
      <aside style={{ width: 232, flexShrink: 0, background: '#ffffff', borderRight: '1px solid #e5e7eb', position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px 12px' }}>
          <img src="/pmi-logo.png" alt="PMI" style={{ height: 34, objectFit: 'contain' }} />
        </div>
        <nav style={{ padding: '4px 10px 16px', flex: 1 }}>
          {NAV.map(node => node.type === 'item' ? (
            <NavRow key={node.label} icon={node.icon} label={node.label} active={node.active} />
          ) : (
            <div key={node.label} style={{ marginTop: 6 }}>
              <button
                onClick={() => setOpen(o => ({ ...o, [node.label]: !o[node.label] }))}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', border: 'none', background: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}
              >
                <span style={{ width: 16, textAlign: 'center', fontSize: 13 }}>{node.icon}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{node.label}</span>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{open[node.label] ? '▾' : '▸'}</span>
              </button>
              {open[node.label] && (
                <div style={{ marginLeft: 8, borderLeft: '1px solid #eef2f7', paddingLeft: 2 }}>
                  {node.items.map(it => <SubRow key={it.label} label={it.label} active={it.active} />)}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#94a3b8' }}>
          MAIA · PMI Top Florida
        </div>
      </aside>

      {/* ── Content area ─────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* slim top strip — search + account (like RentVine) */}
        <div style={{ height: 52, borderBottom: '1px solid #e5e7eb', background: '#fff', position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px' }}>
          <div style={{ fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', minWidth: 280, color: '#94a3b8' }}>Search…</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155' }}>
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#f26a1b', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>JR</span>
            Jonathan R. <span style={{ color: '#94a3b8' }}>▾</span>
          </div>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <AssociationHubMockup />
        </div>
      </div>
    </div>
  )
}

function NavRow({ icon, label, active }: { icon: string; label: string; active?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, marginTop: 2,
      fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
      color: active ? '#c2410c' : '#0f172a', background: active ? '#fff7ed' : 'transparent' }}>
      <span style={{ width: 16, textAlign: 'center', fontSize: 13 }}>{icon}</span>{label}
    </div>
  )
}
function SubRow({ label, active }: { label: string; active?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px 6px 14px', borderRadius: 6, margin: '1px 0', cursor: 'pointer',
      fontSize: 13, fontWeight: active ? 600 : 400,
      color: active ? '#c2410c' : '#475569',
      background: active ? '#fff7ed' : 'transparent',
      borderLeft: active ? '2px solid #f26a1b' : '2px solid transparent', marginLeft: -2 }}>
      {label}
    </div>
  )
}
