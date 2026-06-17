// =====================================================================
// GET /api/admin/vendors/onboarding   (staff-only)
// Lists vendor onboardings + per-doc status, newest first. Powers the
// onboarding tracker (and the "confirm ACH → CINC" worklist).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin.from('vendor_onboarding')
    .select('id, cinc_vendor_id, company_name, email, license_required, coi_status, license_status, w9_status, ach_status, created_at')
    .order('created_at', { ascending: false }).limit(200)
  return NextResponse.json({ onboardings: data ?? [] })
}
