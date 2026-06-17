// =====================================================================
// app/admin/vendor-onboarding/page.tsx
// Staff tracker for in-progress vendor onboardings: per-doc status and the
// "Confirm banking → CINC" action for ACH the vendor has submitted.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import VendorOnboardingClient from './VendorOnboardingClient'

export const metadata = { title: 'Vendor Onboarding — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function VendorOnboardingPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="mx-auto max-w-screen-lg px-6 py-6">
        <header className="mb-5 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">Vendor onboarding</h1>
          <p className="mt-1 text-sm text-gray-500">New vendors being set up in CINC. W-9, COI and license apply automatically; <span className="font-medium text-gray-700">banking (ACH) waits for your confirmation</span> before it&apos;s written to CINC.</p>
        </header>
        <VendorOnboardingClient />
      </main>
    </div>
  )
}
