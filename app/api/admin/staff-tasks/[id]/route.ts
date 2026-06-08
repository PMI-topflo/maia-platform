// PATCH/DELETE /api/admin/staff-tasks/[id] — edit (incl. reassign via
// assignee_email) / soft-delete. Staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RECUR = ['once', 'daily', 'weekly', 'monthly', 'yearly', 'on_expiry']
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
  if (typeof body.assignee_email === 'string' && body.assignee_email.includes('@')) patch.assignee_email = body.assignee_email.trim().toLowerCase()  // reassign
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (RECUR.includes(String(body.recurrence))) patch.recurrence = body.recurrence
  if (body.next_due !== undefined)    patch.next_due = dateOrNull(body.next_due)
  if (body.expiry_date !== undefined) patch.expiry_date = dateOrNull(body.expiry_date)
  if (body.notes !== undefined)       patch.notes = String(body.notes ?? '').trim() || null
  if (typeof body.active === 'boolean') patch.active = body.active
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('staff_tasks').update(patch).eq('id', id)
    .select('id, assignee_email, title, source, recurrence, next_due, expiry_date, notes, active').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffOk())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('staff_tasks').update({ active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
