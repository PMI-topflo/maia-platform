// =====================================================================
// app/admin/flows/vendor-onboarding/page.tsx
//
// Reference diagram of the vendor onboarding flow. Staff-facing — nothing
// interactive server-side, just a maintained snapshot of the flow across
// app/api/admin/vendors/onboard*, app/vendor/onboard/[token]/*, and
// app/api/vendor/onboard/[token]/*.
// =====================================================================

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import VendorOnboardingFlowDiagram from '../../components/VendorOnboardingFlowDiagram'

export const metadata = { title: 'Vendor Onboarding Flow — PMI Top Florida' }

export default function VendorOnboardingFlowPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main style={{ padding: '2rem', maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Vendor Onboarding Flow</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
          How a new vendor gets set up for payment — from a staff dedupe-check and CINC create/link, through the
          vendor&apos;s own token-scoped self-service portal, to W-9/COI/license auto-applying straight to CINC while
          banking (ACH) is deliberately held for a staff fraud-control confirm. Click any box for the exact behavior
          and which file it maps to. This is a maintained reference snapshot, not auto-generated — update it
          alongside the code when the flow changes.
        </p>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem' }}>
            <VendorOnboardingFlowDiagram />
          </div>
        </section>
      </main>
    </div>
  )
}
