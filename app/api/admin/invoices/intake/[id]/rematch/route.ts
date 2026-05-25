// =====================================================================
// app/api/admin/invoices/intake/[id]/rematch/route.ts
// POST — re-run vendor matching on a draft. Called when status is
// 'needs_vendor': Karen creates the missing vendor in CINC, then
// clicks Re-match to retry. We force-refresh the CINC vendor cache
// (so the new vendor is visible) then re-do the fuzzy match.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listVendorsFull, fuzzyMatchVendor, invalidateVendorCache } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  ctx:  { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: draft, error: loadErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, extracted_vendor_name, status')
    .eq('id', id)
    .single()
  if (loadErr || !draft) return NextResponse.json({ error: loadErr?.message ?? 'not found' }, { status: 404 })

  if (!draft.extracted_vendor_name) {
    return NextResponse.json({ error: 'no extracted vendor name to match' }, { status: 400 })
  }

  // Force refresh — Karen just added a vendor in CINC, the cache is stale.
  invalidateVendorCache()
  const vendors = await listVendorsFull({ forceRefresh: true })
  const matched = fuzzyMatchVendor(draft.extracted_vendor_name as string, vendors)

  if (!matched) {
    return NextResponse.json({ matched: false, message: 'still no match — check vendor name spelling in CINC' })
  }

  const { error: updErr } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .update({
      matched_cinc_vendor_id:    String(matched.VendorId),
      matched_vendor_name:       matched.VendorName,
      matched_vendor_short_name: matched.UserDefined1 ?? null,
      status:                    'pending_review',
      updated_at:                new Date().toISOString(),
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({
    matched: true,
    vendor:  { id: matched.VendorId, name: matched.VendorName, shortName: matched.UserDefined1 ?? null },
  })
}
