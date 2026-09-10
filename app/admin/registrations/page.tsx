import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import PeopleTabs from '../components/PeopleTabs'
import RegistrationsDashboard from './components/RegistrationsDashboard'

export const dynamic = 'force-dynamic'

export default async function RegistrationsPage() {
  const [{ data: agents }, { data: vendors }] = await Promise.all([
    supabaseAdmin
      .from('real_estate_agents')
      .select('id, full_name, email, phone, license_number, license_expiry, brokerage, status, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('vendors')
      .select('id, company_name, contact_name, email, phone, service_type, license_number, status, notes, coi_on_file, ach_on_file, w9_on_file, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const pendingAgents  = (agents  ?? []).filter(a => a.status === 'pending')
  const pendingVendors = (vendors ?? []).filter(v => v.status === 'pending')

  return (
    <main className="assoc-page">
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
        <PeopleTabs current="/admin/registrations" />

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'Pending Agents',  count: pendingAgents.length,  color: '#f26a1b' },
            { label: 'Pending Vendors', count: pendingVendors.length,  color: '#f26a1b' },
            { label: 'Total Agents',    count: (agents ?? []).length,  color: '#6b7280' },
            { label: 'Total Vendors',   count: (vendors ?? []).length, color: '#6b7280' },
          ].map(c => (
            <div key={c.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', marginBottom: '0.25rem' }}>{c.label}</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: c.color }}>{c.count}</div>
            </div>
          ))}
        </div>

        <RegistrationsDashboard
          agents={agents ?? []}
          vendors={vendors ?? []}
        />
      </div>
    </main>
  )
}
