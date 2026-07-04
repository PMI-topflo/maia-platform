import { getAssociations } from '../actions'
import UnitStatusClient from './UnitStatusClient'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'

export const metadata = { title: 'Unit Status — PMI Top Florida' }

export default async function UnitStatusPage() {
  const associations = await getAssociations()

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Unit Status</h1>
          <p className="text-sm text-gray-500 mt-1">
            Occupancy (owner-occupied / leased / vacant), lease expiry, and compliance-document completeness across every unit.
          </p>
        </div>

        <UnitStatusClient associations={associations} />
      </main>
    </div>
  )
}
