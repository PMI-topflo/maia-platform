import { getAssociations } from '../actions'
import PreRegistrationsClient from './PreRegistrationsClient'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'

export const metadata = { title: 'Pre-Registrations — PMI Top Florida' }

export default async function PreRegistrationsPage() {
  const associations = await getAssociations()

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Pre-Registrations</h1>
          <p className="text-sm text-gray-500 mt-1">
            Unrecognized callers/contacts who reached MAIA and self-identified — confirm who they are, correct their
            role if needed, approve/add them into the right system, or start an application.
          </p>
        </div>

        <PreRegistrationsClient associations={associations} />
      </main>
    </div>
  )
}
