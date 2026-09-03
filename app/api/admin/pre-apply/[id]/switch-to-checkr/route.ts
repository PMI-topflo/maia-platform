// POST /api/admin/pre-apply/[id]/switch-to-checkr
//
// One-off override: move THIS one application onto maia_checkr even though
// it was created while its association was still on Tenant Evaluation (or
// started before the association flipped) -- normally an application's
// screening_provider is snapshotted at creation and never changes on its
// own (see lib/preapply.ts's resolveScreeningProvider), so staff had no way
// to actually send a Checkr link to an applicant like this short of a
// direct DB edit. Guarded on the association's OWN live setting already
// being maia_checkr -- this is a catch-up for one application, not a way to
// route an application through Checkr on an association nobody has opted
// in yet. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, screening_provider').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (app.screening_provider === 'maia_checkr') return NextResponse.json({ ok: true, alreadyOn: true })

  const { data: assoc } = await supabaseAdmin.from('associations')
    .select('screening_provider').eq('association_code', String(app.association_code)).maybeSingle()
  if ((assoc?.screening_provider as string | null) !== 'maia_checkr') {
    return NextResponse.json({ error: 'This association is not on Checkr yet — flip it on the Association Hub\'s Checklist tab first.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('listing_applications').update({ screening_provider: 'maia_checkr' }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
