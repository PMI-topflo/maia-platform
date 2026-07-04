// =====================================================================
// PATCH /api/admin/pre-registrations/[id]   (staff-only)
// body: { persona?, status? }
// Used by the dashboard for "change persona type" and "dismiss" / marking
// contacted. Does NOT itself insert into owner/board/agent/vendor/tenant —
// those go through the persona-specific add flows (add-person, vendor
// onboarding, tenant verification); this just corrects/tracks the row.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PERSONAS = ['owner', 'tenant', 'buyer', 'board', 'vendor', 'agent', 'other']
const STATUSES = ['new', 'contacted', 'added', 'dismissed']

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = typeof session.userId === 'string' ? session.userId : 'staff'

  const { id } = await ctx.params
  let b: { persona?: string; status?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  if (b.persona !== undefined) {
    if (!PERSONAS.includes(b.persona)) return NextResponse.json({ error: 'invalid persona' }, { status: 400 })
    update.persona = b.persona
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    update.status = b.status
    update.handled_by = me
    update.handled_at = new Date().toISOString()
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { error } = await supabaseAdmin.from('pre_registrations').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
