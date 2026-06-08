// =====================================================================
// PATCH  /api/admin/maintenance/schedules/[id]   → edit fields
// DELETE /api/admin/maintenance/schedules/[id]   → soft-delete (active=false)
// Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CADENCES } from '@/lib/preventive-maintenance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function staffOk() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return !!session && session.persona === 'staff'
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffOk())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  if (typeof body.task === 'string')        patch.task = body.task.trim()
  if (typeof body.cadence === 'string' && CADENCES.includes(body.cadence as never)) patch.cadence = body.cadence
  if (body.weekday !== undefined)           patch.weekday = body.weekday === null ? null : Math.min(6, Math.max(0, Number(body.weekday)))
  if (body.day_of_month !== undefined)      patch.day_of_month = body.day_of_month === null ? null : Math.min(28, Math.max(1, Number(body.day_of_month)))
  if (typeof body.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) patch.start_date = body.start_date
  if (body.vendor_name !== undefined)       patch.vendor_name = String(body.vendor_name ?? '').trim() || null
  if (body.notes !== undefined)             patch.notes = String(body.notes ?? '').trim() || null
  if (typeof body.active === 'boolean')     patch.active = body.active
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('preventive_schedules')
    .update(patch)
    .eq('id', id)
    .select('id, association_code, task, cadence, weekday, day_of_month, start_date, vendor_name, notes, active')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ schedule: data })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffOk())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('preventive_schedules').update({ active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
