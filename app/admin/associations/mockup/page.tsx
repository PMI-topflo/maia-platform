// =====================================================================
// app/admin/associations/mockup/page.tsx
//
// DESIGN MOCKUP (not wired to data) of the proposed "Association Hub" —
// a RentVine-property-style unified view per association. Lives on an
// isolated route so it doesn't touch production pages. Once approved,
// this layout gets folded into /admin/cinc-sync/[code] with real data.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import AssociationHubMockup from './AssociationHubMockup'

export const metadata = { title: 'Association Hub (mockup) — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function AssociationHubMockupPage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav activeOverride="/admin/cinc-sync" />
      </SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <AssociationHubMockup />
      </main>
    </div>
  )
}
