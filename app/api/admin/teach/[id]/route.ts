// =====================================================================
// PATCH  /api/admin/teach/[id]   — approve / reject / edit a knowledge item
// DELETE /api/admin/teach/[id]   — delete it
// Staff-only.
//
// PATCH body (any subset): { status, title, approved_body, association_code, persona }
//   status='approved' stamps reviewed_by. Only approved rows are injected.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireStaff(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

const STATUSES = new Set(['needs_review', 'approved', 'rejected'])

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaff(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : (session.contactName ?? 'staff')

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
  if (typeof body.approved_body === 'string') patch.approved_body = body.approved_body
  if ('association_code' in body) patch.association_code = body.association_code || null
  if ('persona' in body) patch.persona = body.persona || null
  if (typeof body.status === 'string') {
    if (!STATUSES.has(body.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    patch.status = body.status
    if (body.status === 'approved') patch.reviewed_by = actor
  }

  const { data, error } = await supabaseAdmin
    .from('maia_knowledge')
    .update(patch)
    .eq('id', id)
    .select('id, association_code, persona, account_number, unit_number, kind, title, source_kind, source_filename, understood_summary, approved_body, status, created_by, reviewed_by, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('maia_knowledge').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
