// =====================================================================
// app/admin/staff-setup/page.tsx
// Staff Setup — manage each staffer's profile, working hours, and
// recurring task list (which feeds MAIA's daily journal).
// DESIGN MOCKUP for now (static); wired to real tables after sign-off.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import StaffSetupMock from './StaffSetupMock'

export const metadata = { title: 'Staff Setup — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function StaffSetupPage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Staff Setup</h1>
          <Link href="/admin/staff-performance" className="text-xs font-medium text-[#f26a1b] hover:underline">← Staff performance</Link>
        </div>
        <StaffSetupMock />
      </main>
    </div>
  )
}
