import Link from 'next/link'
import { getAssociations, getOwners } from './actions'
import HomeownerDashboard from './components/HomeownerDashboard'
import SiteHeader from '@/components/SiteHeader'

export const metadata = { title: 'HOA Owner Management — PMI Top Florida' }

export default async function AdminPage() {
  const [associations, initialData] = await Promise.all([
    getAssociations(),
    getOwners(1, '', ''),
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/communications"
            className="text-white/70 hover:text-white border border-white/20 hover:border-white/50 [font-family:var(--font-mono)] text-[0.6rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px] transition-colors"
          >
            Communications
          </Link>
          <Link
            href="/admin/new-buyer"
            className="text-white border border-white/30 hover:border-white/60 [font-family:var(--font-mono)] text-[0.6rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px] transition-colors"
          >
            + New Unit Buyer
          </Link>
        </div>
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <HomeownerDashboard
          associations={associations}
          initialOwners={initialData.owners}
          initialTotal={initialData.total}
        />
      </main>
    </div>
  )
}
