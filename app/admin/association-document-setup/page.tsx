import { getAssociations } from '../actions'
import AssociationDocumentSetupClient from './AssociationDocumentSetupClient'
import AssociationApplicationRulesClient from './AssociationApplicationRulesClient'
import AssociationSetupTabs from './AssociationSetupTabs'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'

export const metadata = { title: 'Association Setup — PMI Top Florida' }

export default async function AssociationDocumentSetupPage() {
  const associations = await getAssociations()

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-lg mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Association Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            Custom per-association settings — document requirements (e.g. the City of Lauderhill&apos;s Certificate of Use for Manors XI) and application eligibility rules (e.g. Venetian Park I&apos;s individuals-only / minimum-lease-term restrictions). Both merge into the standard flow wherever they&apos;re used.
          </p>
        </div>

        <AssociationSetupTabs
          documentSetup={<AssociationDocumentSetupClient associations={associations} />}
          applicationRules={<AssociationApplicationRulesClient associations={associations} />}
        />
      </main>
    </div>
  )
}
