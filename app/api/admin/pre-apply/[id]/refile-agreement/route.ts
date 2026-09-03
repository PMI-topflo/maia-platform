// POST /api/admin/pre-apply/[id]/refile-agreement
// Re-render and re-file the unit's Landlord–Tenant Agreement PDF from its
// CURRENT signature state. Staff recovery for a packet completed before
// 2026-09-03: recordLeaseSignature filed the PDF from a stale snapshot
// taken before the completing signer's own signature was recorded, so
// whichever party signed second showed "Awaiting electronic signature" on
// the filed copy even though the database (and this page's own signer-
// status line) correctly had them signed. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { findUnitLeasePacket, refileAgreement } from '@/lib/lease-packet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const code = String(app.association_code)
  const unit = (app.unit_label as string | null) ?? null
  if (!unit) return NextResponse.json({ error: 'This application has no unit on file.' }, { status: 400 })

  const packet = await findUnitLeasePacket(code, unit)
  if (!packet) return NextResponse.json({ error: 'No Landlord–Tenant Agreement on file for this unit.' }, { status: 404 })

  const result = await refileAgreement(packet.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
