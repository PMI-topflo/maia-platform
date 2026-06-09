// =====================================================================
// app/admin/documents/inbox/page.tsx
// MAIA Document Inbox — bulk-upload any association document; MAIA reads
// each, suggests where it files, staff reviews + applies. Staff-only.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import DocumentInboxClient, { type AssocOpt } from './DocumentInboxClient'

export const metadata = { title: 'Document Inbox — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function DocumentInboxPage() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const { data: assocRows } = await supabaseAdmin
    .from('associations').select('association_code, association_name').order('association_name')
  const associations: AssocOpt[] = (assocRows ?? []).map(a => ({ code: String(a.association_code), name: String(a.association_name ?? a.association_code) }))

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <div className="mb-1 flex items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900">Document Inbox</h1>
          <span className="rounded bg-[#f26a1b]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-[#c2410c]">MAIA</span>
        </div>
        <p className="mb-5 text-sm text-gray-500">Drop in any association documents — MAIA reads each, suggests the association + where it files, and you confirm. Nothing files without your review.</p>
        <DocumentInboxClient associations={associations} />
      </main>
    </div>
  )
}
