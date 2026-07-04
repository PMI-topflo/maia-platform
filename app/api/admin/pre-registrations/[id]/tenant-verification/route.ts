// =====================================================================
// GET /api/admin/pre-registrations/[id]/tenant-verification   (staff-only)
// Fetches the tenant_verifications row linked to this pre-registration,
// creating one if it doesn't exist yet (e.g. staff corrected the persona to
// 'tenant' after submission, so no row was auto-created at intake time).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { data: pr } = await supabaseAdmin.from('pre_registrations')
    .select('id, full_name, email, phone, association, unit, persona').eq('id', id).maybeSingle()
  if (!pr) return NextResponse.json({ error: 'pre-registration not found' }, { status: 404 })

  let { data: v } = await supabaseAdmin.from('tenant_verifications').select('*').eq('pre_registration_id', id).maybeSingle()
  if (!v) {
    const { data: created, error } = await supabaseAdmin.from('tenant_verifications').insert({
      pre_registration_id: id, tenant_name: pr.full_name, email: pr.email, phone: pr.phone,
      unit_number: pr.unit, created_by: 'staff',
    }).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    v = created
  }

  return NextResponse.json({ verification: v, associationRaw: pr.association })
}
