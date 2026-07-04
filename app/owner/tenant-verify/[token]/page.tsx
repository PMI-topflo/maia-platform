// =====================================================================
// /owner/tenant-verify/[token] — login-free owner tenant-verification page.
// A unit's owner of record confirms (or disputes) that a self-identified
// person is actually their tenant, and can upload the lease / board
// approval letter on the tenant's behalf if still missing.
// =====================================================================

import { verifyTenantVerifyToken } from '@/lib/tenant-verification-token'
import PortalFormHeader from '@/components/PortalFormHeader'
import TenantVerifyClient from './TenantVerifyClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Confirm your tenant — PMI Top Florida' }

export default async function OwnerTenantVerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = await verifyTenantVerifyToken(token)
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <PortalFormHeader />
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#c2410c', marginBottom: 16 }}>Tenant Verification</div>
        {valid
          ? <TenantVerifyClient token={token} />
          : <p style={{ fontSize: 14, color: '#991b1b' }}>This link is invalid or has expired. Please ask PMI for a new link.</p>}
      </div>
    </div>
  )
}
