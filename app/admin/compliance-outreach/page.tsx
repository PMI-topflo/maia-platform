// =====================================================================
// app/admin/compliance-outreach/page.tsx
//
// Compliance Outreach. Run the owner-document audit one association at a
// time and watch engagement: who's been emailed (Sent), who clicked their
// link (Clicked), and who has uploaded documents (✅ Received, with a link
// to view each file). Server Component for the staff gate; client for the
// interactive workflow.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import ComplianceOutreachClient from './ComplianceOutreachClient'

export const metadata = { title: 'Compliance Outreach — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function ComplianceOutreachPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <header className="mb-5 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">Compliance Outreach</h1>
          <p className="text-sm text-gray-500 mt-1">
            Email owners their document self-service link one association at a time, then track engagement —
            <span className="font-medium text-gray-700"> Sent</span> →
            <span className="font-medium text-gray-700"> Clicked</span> →
            <span className="font-medium text-emerald-700"> ✅ Received</span>.
          </p>
        </header>

        <ComplianceOutreachClient />
      </main>
    </div>
  )
}
