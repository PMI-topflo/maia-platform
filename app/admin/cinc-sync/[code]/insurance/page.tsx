// =====================================================================
// /admin/cinc-sync/[code]/insurance
//
// Per-association MASTER insurance compliance checklist. Renders the
// full Florida HOA/condo coverage list (lib/association-insurance.ts)
// and lets staff record each policy's carrier, dates, coverage, named
// insured, and COI — or waive a coverage that doesn't apply.
//
// SCOPE: association-held master policies (CINC / common-area). The
// per-unit HO-6 policies owners carry live on a different screen
// (unit_insurance) — do not conflate the two.
//
// Server component handles auth + association lookup; the interactive
// checklist is the InsuranceManager client component.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../../components/AdminNav'
import InsuranceManager from './InsuranceManager'

export const metadata = { title: 'Insurance — CINC Sync — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function AssociationInsurancePage(
  props: { params: Promise<{ code: string }> },
) {
  const { code } = await props.params
  const upperCode = code.toUpperCase()

  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const { data: assoc } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .eq('association_code', upperCode)
    .maybeSingle()

  if (!assoc) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
        <main className="max-w-screen-xl mx-auto px-6 py-6">
          <Link href="/admin/cinc-sync" className="text-xs text-[#f26a1b] hover:underline [font-family:var(--font-mono)]">
            ← Back to all associations
          </Link>
          <div className="mt-4 bg-white border border-amber-200 rounded-lg p-6 text-sm text-amber-800">
            No association found with code <code className="bg-amber-50 px-1 rounded">{upperCode}</code>.
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <Link
          href={`/admin/cinc-sync/${assoc.association_code}`}
          className="text-xs text-[#f26a1b] hover:underline [font-family:var(--font-mono)]"
        >
          ← Back to {assoc.association_code} sync
        </Link>

        <header className="mb-6 border-l-4 border-[#f26a1b] pl-4 mt-3">
          <h1 className="text-xl font-semibold text-gray-900">{assoc.association_name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Master insurance compliance — code <span className="font-mono">{assoc.association_code}</span>.
            The association&apos;s own policies (common-element coverage), not the per-unit HO-6 policies owners carry.
            Expiring and expired coverages roll into the daily compliance digest automatically.
          </p>
        </header>

        <InsuranceManager assocCode={assoc.association_code} />
      </main>
    </div>
  )
}
