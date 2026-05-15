// =====================================================================
// app/tenant/maintenance/page.tsx
// "Report a maintenance issue" form for HOA tenants. Submits to
// /api/tenant/maintenance which creates a ticket with the tenant's
// contact info pre-filled from association_tenants.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import MaintenanceForm from './MaintenanceForm'

export const dynamic = 'force-dynamic'

export default async function TenantMaintenancePage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'tenant') redirect('/')

  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : ''
  const assocCode  = (session.associationCode || '').toUpperCase()
  if (!loginEmail || !assocCode) redirect('/tenant')

  const { data: tenant } = await supabaseAdmin
    .from('association_tenants')
    .select('first_name, last_name, unit_number, association_name')
    .eq('association_code', assocCode)
    .ilike('email', loginEmail)
    .order('lease_start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!tenant) redirect('/tenant')

  const assocName = tenant.association_name ?? assocCode
  const tenantName = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') || 'Tenant'

  return (
    <main className="assoc-page">
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223 · WE SPEAK ENGLISH, SPANISH, FRENCH &amp; PORTUGUESE</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle={`TENANT PORTAL · ${assocName}`} />

      <div className="section">
        <Link href="/tenant" style={{ fontSize: '0.75rem', color: 'var(--muted)', textDecoration: 'none' }}>← Back to portal</Link>
        <h2 className="section-title" style={{ marginTop: '0.5rem' }}>Report a Maintenance Issue</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', maxWidth: 640, marginTop: '0.25rem' }}>
          Submit a request to the management team. They&apos;ll dispatch a vendor or follow up by email / phone with next steps. You can track the conversation on this page once it&apos;s logged.
        </p>
      </div>

      <div style={{ padding: '0 1rem 2rem' }}>
        <MaintenanceForm
          tenantName={tenantName}
          unitNumber={tenant.unit_number ?? ''}
          assocName={assocName}
        />
      </div>
    </main>
  )
}
