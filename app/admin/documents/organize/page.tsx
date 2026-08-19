// =====================================================================
// app/admin/documents/organize/page.tsx
// Manors XI Drive file-organize tool — scan a folder, preview each file,
// rename to the YYYY_MM_Type convention. Plan-first: nothing changes until
// you Apply. Staff-only.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import OrganizeClient from './OrganizeClient'
import DuplicateOngoingFolders from './DuplicateOngoingFolders'

export const metadata = { title: 'Organize Drive files — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function OrganizePage() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="mb-1 flex items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900">Organize Drive files</h1>
          <span className="rounded bg-[#f26a1b]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-[#c2410c]">MAIA</span>
        </div>
        <p className="mb-5 text-sm text-gray-500">Scan a Drive folder, preview each file, and rename it to <span className="font-mono">YYYY_MM_Type</span>. Nothing changes until you click Apply.</p>
        <OrganizeClient />
        <DuplicateOngoingFolders />
      </main>
    </div>
  )
}
