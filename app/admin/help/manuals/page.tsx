// =====================================================================
// app/admin/help/manuals/page.tsx
// Maia operating manuals — hub. Cards to each step-by-step manual.
// (Application process is intentionally left for a later manual.)
// =====================================================================

import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'

export const metadata = { title: 'Operating Manuals — PMI Top Florida' }
export const dynamic = 'force-dynamic'

const MANUALS = [
  { href: '/admin/help/manuals/work-orders', icon: '🔧', title: 'Work Order Manual', desc: 'From opening a work order to adding the vendor invoice, board approval, and closing it as paid — including the vendor upload and board approval screens.' },
  { href: '/admin/help/manuals/compliance', icon: '🛡', title: 'Compliance Manual', desc: 'The Compliance Hub, Compliance Outreach (send → clicked → received), and the owner & tenant self-service document screens.' },
  { href: '/admin/help/manuals/financial', icon: '💵', title: 'Financial Manual', desc: 'Invoice intake (emailed + manual upload), reviewing and pushing invoices to CINC, and monthly reconciliation.' },
]

export default async function ManualsHubPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="mx-auto max-w-screen-lg px-6 py-6">
        <header className="mb-6 border-l-4 border-[#f26a1b] pl-4">
          <div className="mb-1 text-xs text-gray-400"><Link href="/admin/help" className="hover:text-[#f26a1b]">Help</Link> / Operating manuals</div>
          <h1 className="text-2xl font-semibold text-gray-900">Maia operating manuals</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">Step-by-step guides for the processes we run in Maia, with pictures of each screen. Pick a manual to get started.</p>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {MANUALS.map(m => (
            <Link key={m.href} href={m.href} className="group rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-[#f26a1b]">
              <div className="text-3xl">{m.icon}</div>
              <div className="mt-2 text-base font-semibold text-gray-900 group-hover:text-[#f26a1b]">{m.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{m.desc}</p>
              <div className="mt-3 text-xs font-medium text-[#f26a1b]">Open manual →</div>
            </Link>
          ))}
        </div>

        <p className="mt-6 text-xs text-gray-400">The application / leasing manual is coming in a later update.</p>
      </main>
    </div>
  )
}
