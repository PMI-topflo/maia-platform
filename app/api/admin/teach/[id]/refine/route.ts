// =====================================================================
// POST /api/admin/teach/[id]/refine   { correction }
// The "correct MAIA" step of the teach loop: staff type a correction in
// plain language; MAIA revises the understanding + canonical knowledge and
// returns the updated item (kept in needs_review until approved). Staff-only.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { refineKnowledge } from '@/lib/maia-knowledge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function requireStaff(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const correction = (body.correction ?? '').toString().trim()
  if (!correction) return NextResponse.json({ error: 'correction is required' }, { status: 400 })

  const { data: row } = await supabaseAdmin
    .from('maia_knowledge')
    .select('id, title, association_code, persona, understood_summary, approved_body')
    .eq('id', id)
    .single()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let associationName: string | null = null
  if (row.association_code) {
    const { data } = await supabaseAdmin.from('associations').select('association_name').eq('association_code', row.association_code).maybeSingle()
    associationName = data?.association_name ?? null
  }

  let refined
  try {
    refined = await refineKnowledge(
      { understood: row.understood_summary, knowledge: row.approved_body, title: row.title },
      correction,
      { associationName, persona: row.persona },
    )
  } catch (e) {
    return NextResponse.json({ error: `MAIA couldn't apply that: ${e instanceof Error ? e.message : 'unknown error'}` }, { status: 502 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('maia_knowledge')
    .update({
      title:              refined.title,
      understood_summary: refined.understood,
      approved_body:      refined.knowledge,
      status:             'needs_review',
      updated_at:         new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, association_code, persona, account_number, unit_number, title, source_kind, source_filename, understood_summary, approved_body, status, created_by, reviewed_by, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: updated })
}
