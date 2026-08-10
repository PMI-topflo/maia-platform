// POST /api/admin/pre-apply/[id]/applicant-score   { stakeholder_id, credit_score }
// Set (or clear) an applicant's credit score — the headline number staff pull
// from their Tenant-Evaluation background check. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let b: { stakeholder_id?: string; credit_score?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const sid = String(b.stakeholder_id ?? '').trim()
  if (!sid) return NextResponse.json({ error: 'stakeholder_id required' }, { status: 400 })

  const raw = b.credit_score
  let score: number | null = null
  if (raw !== null && raw !== '' && raw !== undefined) {
    const n = Math.round(Number(raw))
    if (!Number.isFinite(n) || n < 300 || n > 850) return NextResponse.json({ error: 'Credit score must be 300–850.' }, { status: 400 })
    score = n
  }
  // Scope to this application so a stray id can't touch another app's people.
  const { error } = await supabaseAdmin.from('application_stakeholders')
    .update({ credit_score: score, updated_at: new Date().toISOString() }).eq('id', sid).eq('application_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, credit_score: score })
}
