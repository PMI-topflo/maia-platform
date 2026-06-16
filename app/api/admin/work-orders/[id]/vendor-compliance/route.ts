// =====================================================================
// GET /api/admin/work-orders/[id]/vendor-compliance   (staff-only)
//
// What CINC has on file for this work order's vendor (ACH / W-9 / COI /
// license) — powers the compliance popup Paola sees before adding an
// invoice. If the docs are now on file, clears any stale follow-up flag.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkWoVendorCompliance, clearWoVendorDocsFlag } from '@/lib/wo-vendor-compliance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt((await ctx.params).id, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const c = await checkWoVendorCompliance(id)
  if (!c) return NextResponse.json({ error: 'work order not found' }, { status: 404 })

  // Existing follow-up flag (set when docs were last requested).
  const { data: flag } = await supabaseAdmin.from('tickets')
    .select('vendor_docs_requested_at, vendor_docs_needed').eq('id', id).maybeSingle()
  let requestedAt = (flag?.vendor_docs_requested_at as string | null) ?? null

  // Auto-clear: if everything's on file now, drop a stale flag.
  if (requestedAt && c.canVerify && c.canUpload) { await clearWoVendorDocsFlag(id); requestedAt = null }

  return NextResponse.json({
    vendorName:   c.vendor.vendorName,
    vendorEmail:  c.vendor.vendorEmail,
    cincVendorId: c.vendor.cincVendorId,
    canVerify:    c.canVerify,
    achOnFile:    c.achOnFile,
    w9OnFile:     c.w9OnFile,
    coi:          c.status?.coi ?? null,
    license:      c.status?.license ?? null,
    missing:      c.missing,
    missingKeys:  c.missingKeys,
    canUpload:    c.canUpload,
    requestedAt,
  })
}
