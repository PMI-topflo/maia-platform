// PATCH/DELETE /api/admin/associations/projects/[id] — staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['planning', 'bidding', 'in_progress', 'on_hold', 'complete']
async function staffOk() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return !!session && session.persona === 'staff'
}
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffOk())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string')        patch.name = body.name.trim()
  if (STATUSES.includes(String(body.status))) patch.status = body.status
  if (body.vendor_name !== undefined)       patch.vendor_name = String(body.vendor_name ?? '').trim() || null
  if (body.budget !== undefined)            patch.budget = num(body.budget)
  if (body.spent !== undefined)             patch.spent = num(body.spent)
  if (typeof body.target_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.target_date)) patch.target_date = body.target_date
  if (body.pct_complete !== undefined)      patch.pct_complete = Math.min(100, Math.max(0, Number(body.pct_complete) || 0))
  if (body.notes !== undefined)             patch.notes = String(body.notes ?? '').trim() || null
  if (typeof body.active === 'boolean')     patch.active = body.active
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('association_projects').update(patch).eq('id', id)
    .select('id, association_code, name, status, vendor_name, budget, spent, target_date, pct_complete, notes, active').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffOk())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('association_projects').update({ active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
