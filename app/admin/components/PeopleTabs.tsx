// =====================================================================
// PeopleTabs — one header for the three people-triage pages
// (pre-registrations, agent/vendor registrations, unidentified visitors).
// They are the same job — someone new appeared, decide who they are — so
// the sidebar lists them once ("People to identify") and this bar moves
// between them. User direction, 2026-09-10.
// =====================================================================

import Link from 'next/link'

const TABS = [
  { href: '/admin/pre-registrations', label: 'Pre-registrations', hint: 'self-identified on the portal or by phone' },
  { href: '/admin/registrations',     label: 'Agents & vendors',   hint: 'pending registrations' },
  { href: '/admin/pending-approvals', label: 'Visitors',           hint: 'unidentified, chatted with MAIA' },
]

export default function PeopleTabs({ current }: { current: string }) {
  return (
    <div className="mb-5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f26a1b]">People to identify</div>
      <div className="mt-1 flex gap-1 border-b border-gray-200">
        {TABS.map(t => {
          const on = t.href === current
          return (
            <Link key={t.href} href={t.href} title={t.hint}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${on ? 'border-[#f26a1b] text-[#c0571a]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {t.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
