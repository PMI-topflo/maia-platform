// =====================================================================
// app/admin/personas/page.tsx
// Personas hub — one place to browse everyone MAIA knows (owners, tenants,
// vendors, board members, agents), searchable + filterable by association.
// Per-person message history is a planned follow-up.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import PersonasClient from './PersonasClient'

export const metadata = { title: 'Personas — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function PersonasPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const { data: assocs } = await supabaseAdmin.from('associations').select('association_code, association_name').order('association_name')
  const associations = (assocs ?? []).map(a => ({ code: String(a.association_code), name: String(a.association_name ?? a.association_code) }))

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="mx-auto max-w-screen-2xl px-6 py-6">
        <header className="mb-5 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">Personas</h1>
          <p className="mt-1 text-sm text-gray-500">Everyone MAIA knows — owners, tenants, vendors, board members, agents. Search and filter by association.</p>
        </header>
        <PersonasClient associations={associations} />
      </main>
    </div>
  )
}
