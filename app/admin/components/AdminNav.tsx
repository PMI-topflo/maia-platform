'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Primary navigation. The utility/admin destinations (Performance, CINC
// Sync, Sunbiz, Ideas, Tools) deliberately do NOT live here — they're
// reachable from the "Control Panel" black block on the Staff Dashboard,
// to keep this bar short and legible. Recurring work orders is reached via
// the orange button on the Work Orders page header (not a nav tab).
const NAV_ITEMS: Array<{ label: string; href: string }> = [
  { label: 'Staff Dashboard',   href: '/admin' },
  { label: 'Tickets',           href: '/admin/tickets' },
  { label: 'Work Orders',       href: '/admin/work-orders' },
  { label: 'Invoices',          href: '/admin/invoices' },
  { label: 'Reconciliation',    href: '/admin/reconciliation' },
  { label: 'Monthly Report',    href: '/admin/reports/monthly' },
  { label: 'Communications',    href: '/admin/communications' },
  { label: 'Registrations',     href: '/admin/registrations' },
  { label: 'Applications',      href: '/admin/applications' },
  { label: 'Approvals',         href: '/admin/pending-approvals' },
  { label: 'Ownership',         href: '/admin/ownership-history' },
  { label: 'Tenancy',           href: '/admin/tenancy-history' },
  { label: 'Logins',            href: '/admin/login-history' },
]

/** Optional override so pages whose URL doesn't naturally match the
 *  intended nav item can still highlight the right link. Example: the
 *  ticket detail page lives at /admin/tickets/[id] regardless of type,
 *  so work-order tickets pass `activeOverride='/admin/work-orders'`. */
interface Props {
  activeOverride?: string
}

const TAB_BASE = '[font-family:var(--font-body)] text-sm font-medium px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap'

export default function AdminNav({ activeOverride }: Props = {}) {
  const pathname = usePathname()
  const matchTarget = activeOverride ?? pathname
  const helpActive = matchTarget.startsWith('/admin/help')

  return (
    <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
      {NAV_ITEMS.map(item => {
        const active = item.href === '/admin'
          ? matchTarget === '/admin'
          : matchTarget.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              TAB_BASE,
              active
                ? 'text-[#c2410c] bg-[#fff7ed] font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
            ].join(' ')}
          >
            {item.label}
          </Link>
        )
      })}

      {/* Help — visually separated, always at the end, distinct accent.
          Sign-out lives in the global UserMenu in SiteHeader. */}
      <Link
        href="/admin/help"
        title="Staff procedures + quick links"
        className={[
          TAB_BASE, 'ml-2',
          helpActive
            ? 'text-white bg-[#f26a1b] border border-[#f26a1b]'
            : 'text-[#f26a1b] border border-[#f26a1b]/40 hover:bg-[#f26a1b] hover:text-white',
        ].join(' ')}
      >
        ? Help
      </Link>
    </div>
  )
}
