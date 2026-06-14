// =====================================================================
// /renter/compliance/[token] — login-free TENANT self-service portal.
// Triggered by staff once an owner reports a leased unit + tenant contact.
// The tenant confirms their contact and uploads their documents (HO-4 etc.).
// Token-gated; public route (not in the middleware matcher).
// =====================================================================

import { verifyTenantComplianceToken } from '@/lib/owner-portal-token'
import RenterComplianceClient from './RenterComplianceClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your unit documents — PMI Top Florida' }

export default async function RenterCompliancePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = await verifyTenantComplianceToken(token)
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f26a1b', marginBottom: 14 }}>PMI Top Florida Properties</div>
        {valid
          ? <RenterComplianceClient token={token} />
          : <p style={{ fontSize: 14, color: '#991b1b' }}>This link is invalid or has expired. Please ask PMI for a new link.</p>}
      </div>
    </div>
  )
}
