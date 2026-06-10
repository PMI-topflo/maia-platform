import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import PendingApprovalsDashboard from './components/PendingApprovalsDashboard'

export const metadata = { title: 'Pending Approvals — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function PendingApprovalsPage() {
  const { data: conversations } = await supabaseAdmin
    .from('general_conversations')
    .select('id, session_id, persona, language, association_code, status, channel, contact_name, contact_phone, contact_email, summary, messages, created_at')
    .eq('status', 'unidentified')
    .order('created_at', { ascending: false })
    .limit(200)

  const items = conversations ?? []

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Pending Approvals</h1>
            <p className="text-[0.75rem] text-gray-400 font-mono mt-0.5">Unidentified visitors who couldn&apos;t be matched — review and categorize</p>
          </div>
          <div className="text-2xl font-bold text-[#f26a1b]">{items.length}</div>
        </div>

        <PendingApprovalsDashboard conversations={items} />
      </main>
    </div>
  )
}
