// =====================================================================
// app/admin/flows/pre-application-compliance/page.tsx
//
// Reference diagram of the PLANNED Pre-Application Compliance flow — the
// verified-intake front end that feeds the existing Application Process
// pipeline (Checkr + board). Staff-facing, non-interactive: a maintained
// design snapshot to review with the board, with click-to-preview of the
// page/form each person sees at every step. See the design + schema
// artifact and memory pre_application_compliance.md.
// =====================================================================

import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import PreApplicationComplianceFlowDiagram from '../../components/PreApplicationComplianceFlowDiagram'

export const metadata = { title: 'Pre-Application Compliance Flow — PMI Top Florida' }

export default function PreApplicationComplianceFlowPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main style={{ padding: '2rem', maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Pre-Application Compliance Flow</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
          The verified-intake front end that runs <em>before</em> the{' '}
          <Link href="/admin/flows/application-process" style={{ color: '#1d4ed8' }}>Application Process</Link> (Checkr background
          check + board). One link for a tenant, buyer, or agent → self-identify → pick type → per-type document
          checklist → e-sign forms with a verified signature (email + phone code + location) → PMI + Jonathan audit →
          on-site-manager/board pre-approval → into MAIA + Checkr → board FINAL approval, which archives the Drive
          folder and files compliance. Two of the steps are EXTERNAL (the applicant/agent filling out the intake, and
          the board deciding). Click any box for the exact page/form the person sees. This is a design reference —
          <strong> not yet built</strong> — update it alongside the code as it ships.
        </p>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem' }}>
            <PreApplicationComplianceFlowDiagram />
          </div>
        </section>
      </main>
    </div>
  )
}
