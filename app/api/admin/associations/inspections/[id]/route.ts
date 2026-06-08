// PATCH/DELETE /api/admin/associations/inspections/[id] — staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function staffOk() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return !!session && session.persona === 'staff'
}
const dateOrNull = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffOk())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  if (typeof body.inspection_type === 'string') patch.inspection_type = body.inspection_type.trim()
  if (body.last_done !== undefined)  patch.last_done = dateOrNull(body.last_done)
  if (body.next_due !== undefined)   patch.next_due = dateOrNull(body.next_due)
  if (body.inspector !== undefined)  patch.inspector = String(body.inspector ?? '').trim() || null
  if (body.notes !== undefined)      patch.notes = String(body.notes ?? '').trim() || null
  if (typeof body.active === 'boolean') patch.active = body.active
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('association_inspections').update(patch).eq('id', id)
    .select('id, association_code, inspection_type, last_done, next_due, inspector, notes, active').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inspection: data })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffOk())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('association_inspections').update({ active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
