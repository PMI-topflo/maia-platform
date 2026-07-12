// =====================================================================
// app/admin/flows/application-process/page.tsx
//
// Reference diagram of the tenant/buyer application pipeline — /apply
// through Stripe checkout, Checkr background checks, board review, and
// the applicant's final notification. Staff-facing — nothing interactive
// server-side, just a maintained snapshot of the flow across
// app/apply/*, app/api/trigger-screening, app/api/checkr-webhook,
// app/admin/applications/*, and app/board/review/*.
// =====================================================================

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import ApplicationProcessFlowDiagram from '../../components/ApplicationProcessFlowDiagram'

export const metadata = { title: 'Application Process Flow — PMI Top Florida' }

export default function ApplicationProcessFlowPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main style={{ padding: '2rem', maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Application Process Flow</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
          How a tenant/buyer application moves from the public /apply form through payment, the Checkr background
          check, staff review, and board decision to the applicant&apos;s final notification. Two steps in this flow
          are EXTERNAL (the applicant filling out /apply, and the board member reviewing + deciding) — click any
          box for the exact behavior and which file it maps to. This is a maintained reference snapshot, not
          auto-generated — update it alongside the code when the flow changes.
        </p>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem' }}>
            <ApplicationProcessFlowDiagram />
          </div>
        </section>
      </main>
    </div>
  )
}
