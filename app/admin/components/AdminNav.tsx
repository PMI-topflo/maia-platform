'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Primary navigation. The utility/admin destinations (Performance, CINC
// Sync, Sunbiz, Ideas, Tools) deliberately do NOT live here — they're
// reachable from the "Control Panel" black block on the Staff Dashboard,
// to keep this bar short and legible.
//
// `sub` attaches a compact secondary button to the right of a tab (used to
// fold "Recurring" into "Work Orders" without spending a full tab slot).
const NAV_ITEMS: Array<{ label: string; href: string; sub?: { label: string; href: string } }> = [
  { label: 'Staff Dashboard',   href: '/admin' },
  { label: 'Tickets',           href: '/admin/tickets' },
  { label: 'Work Orders',       href: '/admin/work-orders', sub: { label: '↻ Recurring', href: '/admin/recurring-services' } },
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

const TAB_BASE = '[font-family:var(--font-mono)] text-[0.68rem] uppercase tracking-[0.06em] px-2.5 py-1.5 rounded-[2px] transition-colors whitespace-nowrap'

export default function AdminNav({ activeOverride }: Props = {}) {
  const pathname = usePathname()
  const matchTarget = activeOverride ?? pathname
  const helpActive = matchTarget.startsWith('/admin/help')

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {NAV_ITEMS.map(item => {
        const active = item.href === '/admin'
          ? matchTarget === '/admin'
          : matchTarget.startsWith(item.href)
        const main = (
          <Link
            href={item.href}
            className={[
              TAB_BASE,
              active
                ? 'text-white border border-white/40'
                : 'text-white/65 hover:text-white border border-transparent hover:border-white/20',
            ].join(' ')}
          >
            {item.label}
          </Link>
        )
        if (!item.sub) return <span key={item.href}>{main}</span>

        // Tab with an attached secondary button (Work Orders + Recurring).
        const subActive = matchTarget.startsWith(item.sub.href)
        return (
          <span key={item.href} className="inline-flex items-center">
            {main}
            <Link
              href={item.sub.href}
              title="Recurring services"
              className={[
                '[font-family:var(--font-mono)] text-[0.62rem] uppercase tracking-[0.06em] px-2 py-1.5 -ml-0.5 rounded-[2px] transition-colors whitespace-nowrap',
                subActive
                  ? 'text-white border border-white/40'
                  : 'text-white/45 hover:text-white border border-transparent hover:border-white/20',
              ].join(' ')}
            >
              {item.sub.label}
            </Link>
          </span>
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
