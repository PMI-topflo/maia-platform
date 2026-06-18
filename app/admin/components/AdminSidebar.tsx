'use client'

// =====================================================================
// app/admin/components/AdminSidebar.tsx
// Left navigation sidebar for the staff admin app shell (replaces the
// old horizontal AdminNav). Collapsible menu groups + submenus, wired
// to real routes, active state from the pathname. Rendered once by
// app/admin/layout.tsx; hidden below md (mobile uses the top bar).
// =====================================================================

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

type Leaf  = { label: string; href: string }
type Node =
  | { type: 'item'; label: string; icon: string; href: string }
  | { type: 'group'; label: string; icon: string; items: Leaf[] }

const NAV: Node[] = [
  { type: 'item', label: 'Dashboard', icon: '▦', href: '/admin' },
  { type: 'group', label: 'Operations', icon: '🛠', items: [
    { label: 'Tickets', href: '/admin/tickets' },
    { label: 'Work Orders', href: '/admin/work-orders' },
    { label: 'Recurring Services', href: '/admin/recurring-services' },
    { label: 'Communications', href: '/admin/communications' },
  ] },
  { type: 'item', label: 'Personas', icon: '👤', href: '/admin/personas' },
  { type: 'group', label: 'Associations', icon: '🏢', items: [
    { label: 'Associations', href: '/admin/cinc-sync' },
    { label: 'Document Inbox', href: '/admin/documents/inbox' },
    { label: 'Compliance Outreach', href: '/admin/compliance-outreach' },
    { label: 'Vendor Onboarding', href: '/admin/vendor-onboarding' },
    { label: 'Owners', href: '/admin/owners' },
    { label: 'Board Setup', href: '/admin/board-setup' },
    { label: 'Ownership History', href: '/admin/ownership-history' },
    { label: 'Tenancy History', href: '/admin/tenancy-history' },
  ] },
  { type: 'group', label: 'Accounting', icon: '$', items: [
    { label: 'Invoices', href: '/admin/invoices' },
    { label: 'Reconciliation', href: '/admin/reconciliation' },
    { label: 'Monthly Report', href: '/admin/reports/monthly' },
  ] },
  { type: 'group', label: 'Leasing', icon: '📝', items: [
    { label: 'Applications', href: '/admin/applications' },
    { label: 'Registrations', href: '/admin/registrations' },
    { label: 'Approvals', href: '/admin/pending-approvals' },
  ] },
  { type: 'group', label: 'Tools', icon: '⚙', items: [
    { label: 'Staff Performance', href: '/admin/staff-performance' },
    { label: 'Audit', href: '/admin/audit' },
    { label: 'Login History', href: '/admin/login-history' },
    { label: 'Sunbiz', href: '/admin/sunbiz' },
    { label: 'Ideas', href: '/admin/ideas' },
    { label: 'Skills', href: '/admin/skills' },
    { label: 'Tools', href: '/admin/tools' },
  ] },
  { type: 'item', label: 'Help', icon: '?', href: '/admin/help' },
  { type: 'item', label: 'Operating Manuals', icon: '📘', href: '/admin/help/manuals' },
]

function isActive(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
}

export default function AdminSidebar() {
  const pathname = usePathname()

  // Auto-expand the group that contains the current route; keep the rest
  // as the user toggles them.
  const initialOpen: Record<string, boolean> = {}
  for (const n of NAV) {
    if (n.type === 'group') initialOpen[n.label] = n.items.some(i => isActive(pathname, i.href))
  }
  const [open, setOpen] = useState<Record<string, boolean>>(initialOpen)

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[232px] flex-col overflow-y-auto border-r border-gray-200 bg-white md:flex">
      {/* Brand */}
      <Link href="/admin" className="flex h-16 items-center border-b border-gray-100 px-4">
        <Image src="/pmi-logo.png" alt="PMI Top Florida Properties" width={150} height={40} style={{ objectFit: 'contain' }} />
      </Link>

      <nav className="flex-1 p-2.5">
        {NAV.map(node => node.type === 'item' ? (
          <Link
            key={node.label}
            href={node.href}
            className={`mt-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-semibold transition-colors ${
              isActive(pathname, node.href)
                ? 'bg-[#fff4ee] text-[#c2410c]'
                : 'text-slate-900 hover:bg-slate-50'
            }`}
          >
            <span className="w-4 text-center text-[13px]">{node.icon}</span>{node.label}
          </Link>
        ) : (
          <div key={node.label} className="mt-1.5">
            <button
              onClick={() => setOpen(o => ({ ...o, [node.label]: !o[node.label] }))}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] font-semibold text-slate-900 hover:bg-slate-50"
            >
              <span className="w-4 text-center text-[13px]">{node.icon}</span>
              <span className="flex-1">{node.label}</span>
              <span className="text-[10px] text-slate-400">{open[node.label] ? '▾' : '▸'}</span>
            </button>
            {open[node.label] && (
              <div className="ml-3 border-l border-gray-100 pl-1.5">
                {node.items.map(it => {
                  const active = isActive(pathname, it.href)
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={`-ml-0.5 my-px flex items-center rounded-md border-l-2 px-2.5 py-1.5 text-[13px] transition-colors ${
                        active
                          ? 'border-[#f26a1b] bg-[#fff4ee] font-semibold text-[#c2410c]'
                          : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      {it.label}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-100 px-4 py-3 text-[11px] text-slate-400">
        Maia · PMI Top Florida
      </div>
    </aside>
  )
}
