// =====================================================================
// /vendor/onboard/[token] — login-free vendor ONBOARDING portal
//
// A brand-new vendor opens the link MAIA emailed them and provides their
// W-9, ACH banking, COI, and (if required) license — all against the CINC
// vendor staff just created. Token-gated, no account. Public route (not in
// the middleware matcher).
// =====================================================================

import { verifyVendorOnboardingToken } from '@/lib/vendor-onboarding-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import PortalFormHeader from '@/components/PortalFormHeader'
import OnboardClient from './OnboardClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vendor setup — PMI Top Florida' }

export default async function VendorOnboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const id = await verifyVendorOnboardingToken(token)
  const row = id
    ? (await supabaseAdmin.from('vendor_onboarding')
        .select('company_name, coi_status, license_status, w9_status, ach_status, license_required')
        .eq('id', id).maybeSingle()).data
    : null

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <PortalFormHeader />
        {!row ? (
          <div style={{ marginTop: 16, padding: 18, background: '#fff', border: '1px solid #fde68a', borderRadius: 12, color: '#92400e', fontSize: 14 }}>
            This setup link is invalid or has expired. Please ask PMI Top Florida Properties for a new link.
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>Vendor setup</h1>
            <OnboardClient
              token={token}
              company={(row.company_name as string | null) ?? null}
              row={{
                coi_status:     String(row.coi_status ?? 'pending'),
                license_status: String(row.license_status ?? 'na'),
                w9_status:      String(row.w9_status ?? 'pending'),
                ach_status:     String(row.ach_status ?? 'pending'),
                license_required: !!row.license_required,
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
