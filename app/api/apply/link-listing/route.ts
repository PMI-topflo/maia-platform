// =====================================================================
// POST /api/apply/link-listing
//
// Links a completed detailed application (public.applications row) back to the
// collaborative listing_applications record. Called by the /apply wizard once
// it creates its application row, when the wizard was opened from a stakeholder
// flow (?listingApp=<id>). Public — only writes the loose detailed_application_id
// link + flips the listing application to "submitted".
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let b: { listingApplicationId?: string; detailedApplicationId?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const listingApplicationId  = (b.listingApplicationId  ?? '').trim()
  const detailedApplicationId = (b.detailedApplicationId ?? '').trim()
  if (!listingApplicationId || !detailedApplicationId) {
    return NextResponse.json({ error: 'both ids are required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('listing_applications').update({
    detailed_application_id: detailedApplicationId,
    status: 'submitted',
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', listingApplicationId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark this group's applicant stakeholders as completed.
  await supabaseAdmin.from('application_stakeholders')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('application_id', listingApplicationId).eq('role', 'applicant')

  return NextResponse.json({ ok: true })
}
