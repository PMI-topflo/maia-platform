// =====================================================================
// app/admin/audit/page.tsx
//
// Compliance Hub. One place to: upload any association document (MAIA reads
// it and files it after review), pick an association to see its full document
// set (present / missing, with the filed file) including Sunbiz, and review
// the unit-level lease / insurance / CoU / violation table.
// Server Component for the data fetch; client for the interactive hub.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import { AuditTable } from './AuditTable'
import ComplianceHubClient from './ComplianceHubClient'
import type { AssocOpt } from '../documents/inbox/DocumentInboxClient'

export const metadata = { title: 'Compliance Hub — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function AuditPage(props: { searchParams: Promise<{ association?: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const { association } = await props.searchParams

  const [
    { data: compliance },
    { data: homeowners },
    { data: alerts },
    { data: configs },
    { data: assocRows },
  ] = await Promise.all([
    supabaseAdmin.from('v_unit_compliance').select('*'),
    supabaseAdmin.from('owners').select('account_number, association_code, association_name, street_number, address, unit_number, first_name, last_name, emails'),
    supabaseAdmin.from('compliance_alerts').select('account_number, severity, alert_type, message, days_delta').is('resolved_at', null),
    supabaseAdmin.from('association_config').select('association_code, is_master, requires_cou'),
    supabaseAdmin.from('associations').select('association_code, association_name').order('association_name'),
  ])

  const associations: AssocOpt[] = (assocRows ?? []).map(a => ({ code: String(a.association_code), name: String(a.association_name ?? a.association_code) }))

  const unitsView = (
    <AuditTable
      compliance={compliance ?? []}
      homeowners={homeowners ?? []}
      alerts={alerts ?? []}
      configs={configs ?? []}
      initialAssociation={association}
    />
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <header className="mb-5 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">Compliance Hub</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload any association document — MAIA reads it and files it after your review. Pick an association to see its full document set (present &amp; missing), including Sunbiz.
          </p>
        </header>

        <ComplianceHubClient associations={associations} initialAssociation={association ?? null} unitsView={unitsView} />
      </main>
    </div>
  )
}
