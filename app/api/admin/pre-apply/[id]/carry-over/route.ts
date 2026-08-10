// POST /api/admin/pre-apply/[id]/carry-over
// Bring the previous approved term's keeper files (Signed Lease, Certificate of
// Use, HO-6, governing-docs ack, affidavit, agreement) into this application —
// used on a lease renewal or additional occupant so the prior term's documents
// carry forward. Independent storage copies; the Board Approval Letter is not
// carried (a new one is issued). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { carryOverApprovedDocs } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const count = await carryOverApprovedDocs(id, String(app.association_code), (app.unit_label as string | null) ?? null)
  return NextResponse.json({ ok: true, count })
}
