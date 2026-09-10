// =====================================================================
// /admin/cinc-sync/[code]/onboarding
//
// The association onboarding questionnaire — applications scope. Every
// answer is a timestamped, attributed decision (lib/onboarding.ts); nothing
// touches a live setting until the board adopts it in the last section.
// =====================================================================

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../../components/AdminNav'
import OnboardingClient from './OnboardingClient'

export const metadata = { title: 'Onboarding questionnaire — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function OnboardingPage({ params }: { params: Promise<{ code: string }> }) {
  const session = await requireStaffSession()
  if (!session) redirect('/admin/login')
  const { code } = await params
  const upper = code.toUpperCase()
  const { data: assoc } = await supabaseAdmin.from('associations').select('association_code, association_name').eq('association_code', upper).maybeSingle()
  if (!assoc) redirect('/admin/cinc-sync')

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <div className="mb-1 text-xs text-gray-400">
          <Link href="/admin/cinc-sync" className="hover:text-[#f26a1b]">Associations</Link> / <Link href={`/admin/cinc-sync/${upper}`} className="hover:text-[#f26a1b]">{assoc.association_name}</Link> / Onboarding
        </div>
        <OnboardingClient code={upper} name={String(assoc.association_name ?? upper)} staffName={session.displayName} />
      </main>
    </div>
  )
}
