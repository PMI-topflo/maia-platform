// =====================================================================
// /api/admin/association-application-rules/[id]   (staff-only)
// PATCH  { active?, value?, label?, enforcement? } — toggle or edit one.
// DELETE — remove it entirely.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENFORCEMENT_VALUES = ['block', 'warn']

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  let body: { active?: boolean; value?: unknown; label?: string; enforcement?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.active !== undefined) update.active = body.active
  if (body.value !== undefined) update.value = body.value
  if (body.label !== undefined) update.label = body.label
  if (body.enforcement !== undefined) {
    if (!ENFORCEMENT_VALUES.includes(body.enforcement)) return NextResponse.json({ error: 'invalid enforcement' }, { status: 400 })
    update.enforcement = body.enforcement
  }

  const { data, error } = await supabaseAdmin.from('association_application_rules').update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rule: data })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('association_application_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
