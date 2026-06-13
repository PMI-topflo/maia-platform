// =====================================================================
// /admin/vendor-compliance — vendor compliance audit
// Lists vendors with current work orders, their CINC compliance state
// (ACH / W-9 / COI / license + expiry), their files, and a one-click
// "request missing docs" email (editable before send). Staff-only.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { loadVendorComplianceOverview } from '@/lib/vendor-compliance-overview'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import VendorComplianceClient from './VendorComplianceClient'

export const metadata = { title: 'Vendor Compliance — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function VendorCompliancePage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const rows = await loadVendorComplianceOverview()

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="VENDOR COMPLIANCE">
        <AdminNav />
      </SiteHeader>
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <VendorComplianceClient rows={rows} />
      </main>
    </div>
  )
}
