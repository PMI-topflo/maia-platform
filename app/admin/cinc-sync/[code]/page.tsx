import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getContactsAndConsentFlag } from '@/lib/integrations/cinc'
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

  const [{ data: assocRow }, contactsFlagOn] = await Promise.all([
    supabaseAdmin
      .from('associations')
      .select('association_code, association_name')
      .eq('association_code', upperCode)
      .maybeSingle(),
    // Check whether CINC has enabled the Contacts and Consent feature
    // on our tenant — if it has, our v1 associationWithProperty call
    // will stop working and we need to migrate. Best-effort: null on
    // any failure, banner only renders when we know it's true.
    getContactsAndConsentFlag().catch(() => null),
  ])

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
            <div className="flex items-center gap-2">
              <Link
                href={`/admin/reports/monthly?assoc=${assocRow.association_code}`}
                className="text-xs font-mono uppercase tracking-wide text-[#f26a1b] hover:text-white hover:bg-[#f26a1b] border border-[#f26a1b] px-2.5 py-1 rounded transition-colors"
              >
                📊 Monthly report →
              </Link>
              <Link
                href={`/admin/cinc-sync/${assocRow.association_code}/documents`}
                className="text-xs font-mono uppercase tracking-wide text-[#f26a1b] hover:text-white hover:bg-[#f26a1b] border border-[#f26a1b] px-2.5 py-1 rounded transition-colors"
              >
                📄 Documents →
              </Link>
              <Link
                href={`/admin/cinc-sync/${assocRow.association_code}/insurance`}
                className="text-xs font-mono uppercase tracking-wide text-[#f26a1b] hover:text-white hover:bg-[#f26a1b] border border-[#f26a1b] px-2.5 py-1 rounded transition-colors"
              >
                🛡 Insurance →
              </Link>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Code <span className="font-mono">{assocRow.association_code}</span>. Diff against CINC&apos;s homeowner + board endpoints. Pick rows to apply.
            Manage uploaded policies, bylaws, and other documents on the <Link href={`/admin/cinc-sync/${assocRow.association_code}/documents`} className="text-[#f26a1b] hover:underline">Documents page</Link>.
          </p>
        </header>

        {/* Advance-warning banner: CINC announced a "Contacts and Consent"
            rollout (doc dated 12/19/2025) that retires the v1 endpoint this
            sync depends on. We poll /homeowners/contactsFlag — when CINC
            flips it on for our tenant, the v1 call breaks and we MUST
            migrate to v2 + propertyContacts. See CINC_API.md. */}
        {contactsFlagOn === true && (
          <div className="mb-4 rounded border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">
            <div className="font-semibold">⚠ CINC Contacts and Consent feature is ENABLED on this tenant.</div>
            <div className="mt-1">
              The v1 <code className="bg-red-100 px-1 rounded">associationWithProperty</code> endpoint that powers this sync
              is now retired by CINC. Run a sync to confirm — if it fails, MAIA needs the v2 migration shipped before this
              page can be used again. See <code>CINC_API.md → Contacts and Consent migration</code>.
            </div>
          </div>
        )}

        <SyncPreviewClient assocCode={assocRow.association_code} />
      </main>
    </div>
  )
}
