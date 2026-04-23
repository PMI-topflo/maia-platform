import Link from 'next/link'
import { getAssociations, getOwners } from './actions'
import HomeownerDashboard from './components/HomeownerDashboard'

export const metadata = { title: 'HOA Owner Management — PMI Top Florida' }

export default async function AdminPage() {
  const [associations, initialData] = await Promise.all([
    getAssociations(),
    getOwners(1, '', ''),
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">HOA Owner Management</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              PMI Top Florida Properties · {initialData.total} homeowners · {associations.length} associations
            </p>
          </div>
          <Link
            href="/admin/new-buyer"
            className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + New Unit Buyer
          </Link>
        </div>
      </header>

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
