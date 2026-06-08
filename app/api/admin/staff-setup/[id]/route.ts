// PATCH /api/admin/staff-setup/[id] — update a staff member's profile +
// working hours (alias, personal email/phone, company phone, working_hours).
// Staff-only.
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffOk())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  const str = (k: string) => { if (body[k] !== undefined) patch[k] = String(body[k] ?? '').trim() || null }
  if (typeof body.name === 'string') patch.name = body.name.trim()
  if (typeof body.role === 'string') patch.role = body.role.trim() || null
  str('alias'); str('personal_email'); str('personal_phone'); str('phone')
  if (body.working_hours !== undefined && Array.isArray(body.working_hours)) patch.working_hours = body.working_hours
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('pmi_staff').update(patch).eq('id', id)
    .select('id, name, email, role, alias, personal_email, personal_phone, phone, working_hours').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ staff: data })
}
