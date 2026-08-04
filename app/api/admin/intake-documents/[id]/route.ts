// PATCH  /api/admin/intake-documents/[id]  { label?, provided_by?, required?, note?, sort_order?, active? }
// DELETE /api/admin/intake-documents/[id]
// Edit or remove one intake checklist row. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { label?: string; provided_by?: string; required?: boolean; note?: string; sort_order?: number; active?: boolean }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b.label === 'string') patch.label = b.label.trim()
  if (['applicant', 'landlord', 'agent'].includes(String(b.provided_by))) patch.provided_by = b.provided_by
  if (typeof b.required === 'boolean') patch.required = b.required
  if (b.note !== undefined) patch.note = b.note?.trim() || null
  if (typeof b.sort_order === 'number') patch.sort_order = b.sort_order
  if (typeof b.active === 'boolean') patch.active = b.active

  const { error } = await supabaseAdmin.from('association_intake_documents').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('association_intake_documents').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
