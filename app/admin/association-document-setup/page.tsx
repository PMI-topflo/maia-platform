import { getAssociations } from '../actions'
import AssociationDocumentSetupClient from './AssociationDocumentSetupClient'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'

export const metadata = { title: 'Association Document Setup — PMI Top Florida' }

export default async function AssociationDocumentSetupPage() {
  const associations = await getAssociations()

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-lg mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Association Document Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            Custom unit-level document requirements for one association only — e.g. the City of Lauderhill&apos;s Certificate of Use (Manors XI), or a lease addendum a specific association wants signed. These merge into the standard requirement list wherever it&apos;s used (owner portal, unit dashboard, resend requests).
          </p>
        </div>

        <AssociationDocumentSetupClient associations={associations} />
      </main>
    </div>
  )
}
