// =====================================================================
// PATCH /api/admin/tenant-verifications/[id]   (staff-only)
// body: { association_code?, association_name?, unit_number?, tenant_name?,
//         email?, phone?, lease_start_date? }
// Staff resolves the pre-registration's free-text association/unit into a
// real association_code — required before an owner-confirm link can be
// sent (the owner lookup needs a real association_code + unit_number).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIELDS = ['association_code', 'association_name', 'unit_number', 'tenant_name', 'email', 'phone', 'lease_start_date'] as const

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { data: v } = await supabaseAdmin.from('tenant_verifications').select('*').eq('id', id).maybeSingle()
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ verification: v })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  for (const f of FIELDS) if (body[f] !== undefined) update[f] = body[f] || null
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  update.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin.from('tenant_verifications').update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, verification: data })
}
