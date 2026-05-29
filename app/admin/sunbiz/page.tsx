// =====================================================================
// /admin/sunbiz
//
// Florida Sunbiz annual-report tracker. One row per active association
// showing whether THIS year's annual report has been filed, the
// deadline status (due May 1; $400 late fee after; administrative
// dissolution by the 4th Friday of September), and a quick "mark filed"
// action with the Sunbiz confirmation number.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import SunbizManager from './SunbizManager'

export const metadata = { title: 'Sunbiz Filings — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function SunbizPage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <header className="mb-6 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">Sunbiz Annual Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Florida Division of Corporations annual report — due <strong>May 1</strong> each year.
            A $400 late fee applies after May 1, and an association is <strong>administratively dissolved</strong> if
            still unfiled by the 4th Friday of September. Record each filing&apos;s confirmation number here.
          </p>
        </header>
        <SunbizManager />
      </main>
    </div>
  )
}
