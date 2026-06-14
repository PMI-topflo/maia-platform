// =====================================================================
// /owner/compliance/[token] — login-free OWNER self-service compliance portal
// The owner confirms their unit's occupancy (owner-occupied / leased /
// vacant) and uploads the documents still missing for their unit. Token-gated;
// public route (not in the middleware matcher).
// =====================================================================

import { verifyOwnerComplianceToken } from '@/lib/owner-portal-token'
import OwnerComplianceClient from './OwnerComplianceClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your unit documents — PMI Top Florida' }

export default async function OwnerCompliancePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = await verifyOwnerComplianceToken(token)

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f26a1b', marginBottom: 14 }}>PMI Top Florida Properties</div>
        {valid
          ? <OwnerComplianceClient token={token} />
          : <p style={{ fontSize: 14, color: '#991b1b' }}>This link is invalid or has expired. Please ask PMI for a new link.</p>}
      </div>
    </div>
  )
}
