import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'

export const metadata = { title: 'CINC Sync — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function CincSyncIndexPage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const { data: associations } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .order('association_name')

  // Quick count of owners + board per assoc so staff can see scale before clicking in
  const { data: ownerCounts } = await supabaseAdmin
    .from('owners')
    .select('association_code')
    .or('status.neq.previous,status.is.null')
  const { data: boardCounts } = await supabaseAdmin
    .from('association_board_members')
    .select('association_code')
    .eq('active', true)

  const ownerByCode: Record<string, number> = {}
  for (const o of (ownerCounts ?? [])) {
    if (o.association_code) ownerByCode[o.association_code] = (ownerByCode[o.association_code] ?? 0) + 1
  }
  const boardByCode: Record<string, number> = {}
  for (const b of (boardCounts ?? [])) {
    if (b.association_code) boardByCode[b.association_code] = (boardByCode[b.association_code] ?? 0) + 1
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <header className="mb-6 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">CINC Sync</h1>
          <p className="text-sm text-gray-500 mt-1">
            Compare each association&apos;s owners and board members against CINC. Click an association to see a side-by-side diff and selectively apply changes.
          </p>
        </header>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Code</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Association</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Owners in MAIA</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Board in MAIA</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(associations ?? []).map(a => (
                <tr key={a.association_code} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{a.association_code}</td>
                  <td className="px-4 py-2 text-gray-800">{a.association_name}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{ownerByCode[a.association_code] ?? 0}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{boardByCode[a.association_code] ?? 0}</td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/admin/cinc-sync/${a.association_code}`}
                      className="text-[#f26a1b] hover:underline text-xs font-mono uppercase tracking-wide"
                    >
                      Compare →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
