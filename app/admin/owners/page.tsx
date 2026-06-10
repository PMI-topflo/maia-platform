import { getAssociations, getOwners } from '../actions'
import HomeownerDashboard from '../components/HomeownerDashboard'
import AdminHeader from '../components/AdminHeader'
import SiteHeader from '@/components/SiteHeader'

export const metadata = { title: 'Owners — PMI Top Florida' }

export default async function OwnersPage() {
  const [associations, initialData] = await Promise.all([
    getAssociations(),
    getOwners(1, '', ''),
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminHeader associations={associations} />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <HomeownerDashboard
          associations={associations}
          initialOwners={initialData.owners}
          initialTotal={initialData.total}
        />
      </main>
    </div>
  )
}
