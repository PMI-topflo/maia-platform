// =====================================================================
// /api/admin/association-document-requirements/[id]   (staff-only)
// PATCH  { active?, label?, occupancyFilter? } — toggle or edit one.
// DELETE — remove it entirely.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OCC_VALUES = ['owner_occupied', 'leased', 'vacant']

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  let body: { active?: boolean; label?: string; occupancyFilter?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.active !== undefined) update.active = body.active
  if (body.label !== undefined) update.label = body.label
  if (body.occupancyFilter !== undefined) {
    if (body.occupancyFilter && !OCC_VALUES.includes(body.occupancyFilter)) return NextResponse.json({ error: 'invalid occupancy filter' }, { status: 400 })
    update.occupancy_filter = body.occupancyFilter || null
  }

  const { data, error } = await supabaseAdmin.from('association_document_requirements').update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, requirement: data })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('association_document_requirements').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
