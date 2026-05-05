'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { label: 'Overview',          href: '/admin' },
  { label: 'Owners',            href: '/admin/owners' },
  { label: 'Communications',    href: '/admin/communications' },
  { label: 'Registrations',     href: '/admin/registrations' },
  { label: 'Applications',      href: '/admin/applications' },
  { label: 'Approvals',         href: '/admin/pending-approvals' },
  { label: 'Omnichannel',       href: '/admin/omnichannel' },
  { label: 'Ownership',         href: '/admin/ownership-history' },
  { label: 'Tenancy',           href: '/admin/tenancy-history' },
  { label: 'Logins',            href: '/admin/login-history' },
  { label: 'Tools',             href: '/admin/tools' },
]

export default function AdminNav() {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {NAV_ITEMS.map(item => {
        const active = item.href === '/admin'
          ? pathname === '/admin'
          : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              '[font-family:var(--font-mono)] text-[0.6rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px] transition-colors',
              active
                ? 'text-white border border-white/40'
                : 'text-white/60 hover:text-white border border-transparent hover:border-white/20',
            ].join(' ')}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
