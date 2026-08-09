// POST /api/admin/pre-apply/[id]/meta   { application_type?, applicant_name? }
// Edit an application's type (new lease / lease renewal / purchase / additional
// occupant) and the applicant's name — the latter creates/updates the primary
// applicant stakeholder (imported/Drive-only apps have none, so the name shows
// as "—" until set here). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isApplicationType } from '@/lib/intake-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, listing_id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let b: { application_type?: string; applicant_name?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  if (typeof b.application_type === 'string' && b.application_type.trim()) {
    if (!isApplicationType(b.application_type.trim())) return NextResponse.json({ error: 'invalid application type' }, { status: 400 })
    await supabaseAdmin.from('listing_applications').update({ application_type: b.application_type.trim(), updated_at: new Date().toISOString() }).eq('id', id)
  }

  if (typeof b.applicant_name === 'string') {
    const name = b.applicant_name.trim()
    const { data: primary } = await supabaseAdmin.from('application_stakeholders')
      .select('id').eq('application_id', id).eq('is_primary', true).maybeSingle()
    if (primary) {
      await supabaseAdmin.from('application_stakeholders').update({ name: name || null, updated_at: new Date().toISOString() }).eq('id', primary.id)
    } else if (name) {
      await supabaseAdmin.from('application_stakeholders').insert({
        application_id: id, role: 'applicant', name, is_primary: true, status: 'active', added_by_role: 'staff',
      })
    }
  }

  return NextResponse.json({ ok: true })
}
