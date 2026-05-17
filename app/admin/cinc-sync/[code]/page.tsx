import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import SyncPreviewClient from './SyncPreviewClient'

export const metadata = { title: 'CINC Sync — Association — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function CincSyncDetailPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params
  const upperCode = code.toUpperCase()

  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .eq('association_code', upperCode)
    .maybeSingle()

  if (!assocRow) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
        <main className="max-w-screen-xl mx-auto px-6 py-6">
          <Link href="/admin/cinc-sync" className="text-xs text-[#f26a1b] hover:underline [font-family:var(--font-mono)]">← Back to all associations</Link>
          <div className="mt-4 bg-white border border-amber-200 rounded-lg p-6 text-sm text-amber-800">
            No association found with code <code className="bg-amber-50 px-1 rounded">{upperCode}</code>.
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <Link href="/admin/cinc-sync" className="text-xs text-[#f26a1b] hover:underline [font-family:var(--font-mono)]">← Back to all associations</Link>
        <header className="mb-6 border-l-4 border-[#f26a1b] pl-4 mt-3">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h1 className="text-xl font-semibold text-gray-900">{assocRow.association_name}</h1>
            <Link
              href={`/admin/cinc-sync/${assocRow.association_code}/documents`}
              className="text-xs font-mono uppercase tracking-wide text-[#f26a1b] hover:text-white hover:bg-[#f26a1b] border border-[#f26a1b] px-2.5 py-1 rounded transition-colors"
            >
              📄 Documents →
            </Link>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Code <span className="font-mono">{assocRow.association_code}</span>. Diff against CINC&apos;s homeowner + board endpoints. Pick rows to apply.
            Manage uploaded policies, bylaws, and other documents on the <Link href={`/admin/cinc-sync/${assocRow.association_code}/documents`} className="text-[#f26a1b] hover:underline">Documents page</Link>.
          </p>
        </header>

        <SyncPreviewClient assocCode={assocRow.association_code} />
      </main>
    </div>
  )
}
