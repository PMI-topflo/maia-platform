// =====================================================================
// /admin/recurring-services — set up each association's fixed recurring
// vendors (landscaping/pool/janitorial/pest) + the vendor crew who get
// weekly upload links. Phase 1: setup only (visits/cron come later).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import Manager from './Manager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Recurring services — PMI Top Florida' }

export default async function RecurringServicesPage() {
  const { data } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .eq('active', true)
    .order('association_name')
  const associations = (data ?? []).map(r => ({ code: String(r.association_code ?? ''), name: String(r.association_name ?? '') }))

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="RECURRING SERVICES"><AdminNav /></SiteHeader>
      <Manager associations={associations} />
    </div>
  )
}
