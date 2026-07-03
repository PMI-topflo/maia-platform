// =====================================================================
// app/admin/flows/estimate-approval/page.tsx
//
// Reference diagram of the estimate request → vendor quotes → board
// comparison → e-sign approval flow. Staff-facing — nothing interactive
// server-side, just a maintained snapshot of the flow across
// app/api/admin/work-orders/[id]/estimate-*, app/api/board/estimate/*,
// and lib/estimate-approval-pdf.ts.
// =====================================================================

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import EstimateApprovalFlowDiagram from '../../components/EstimateApprovalFlowDiagram'

export const metadata = { title: 'Estimate & Board Approval Flow — PMI Top Florida' }

export default function EstimateApprovalFlowPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main style={{ padding: '2rem', maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Estimate & Board Approval Flow</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
          How a work order gets quoted, compared, and approved — from inviting vendors for estimates through the
          board picking a winner and e-signing. Two steps in this flow are EXTERNAL (the vendor submitting a quote,
          and the board member reviewing + signing) — click any box for the exact behavior and which file it maps to.
          This is a maintained reference snapshot, not auto-generated — update it alongside the code when the flow changes.
        </p>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem' }}>
            <EstimateApprovalFlowDiagram />
          </div>
        </section>
      </main>
    </div>
  )
}
