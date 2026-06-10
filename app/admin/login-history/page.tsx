import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import LoginHistoryDashboard from './components/LoginHistoryDashboard'

export const metadata = { title: 'Login History — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function LoginHistoryPage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: events } = await supabaseAdmin
    .from('login_history')
    .select('id, event, identifier, persona, association_code, association_name, method, ip_address, success, failure_reason, created_at')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(2000)

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Login History</h1>
            <p className="text-[0.75rem] text-gray-400 font-mono mt-0.5">OTP activity log — last 30 days</p>
          </div>
        </div>

        <LoginHistoryDashboard events={events ?? []} />
      </main>
    </div>
  )
}
