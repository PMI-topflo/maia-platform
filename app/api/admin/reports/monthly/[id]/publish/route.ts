// =====================================================================
// /api/admin/reports/monthly/[id]/publish
//
// POST   — publish a saved monthly report to an audience
//          ('board' | 'owners' | 'both'). Sets published_at / audience
//          / published_by_email. Re-publishing replaces the audience.
// DELETE — un-publish (clears published_at / audience).
//
// Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ReportAudience } from '@/lib/monthly-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_AUDIENCES: ReportAudience[] = ['board', 'owners', 'both']

async function staffEmail(): Promise<string | null | false> {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return false
  return typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : null
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const email = await staffEmail()
  if (email === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  let body: { audience?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const audience = body.audience
  if (typeof audience !== 'string' || !VALID_AUDIENCES.includes(audience as ReportAudience)) {
    return NextResponse.json({ error: 'audience must be "board", "owners", or "both"' }, { status: 400 })
  }

  // Refuse to publish an all-associations report — there's no specific
  // board or association portal to surface it on (canViewPublishedReport
  // would never authorize a board/owner viewer for an 'ALL' report).
  const { data: report, error: lookupErr } = await supabaseAdmin
    .from('monthly_reports')
    .select('id, association_code')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr || !report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }
  if (report.association_code === 'ALL') {
    return NextResponse.json(
      { error: 'Publishing is per-association — generate this report for a single association first.' },
      { status: 400 },
    )
  }

  const { error: updErr } = await supabaseAdmin
    .from('monthly_reports')
    .update({
      published_at:       new Date().toISOString(),
      published_audience: audience,
      published_by_email: email,
    })
    .eq('id', id)
  if (updErr) {
    return NextResponse.json({ error: `Could not publish: ${updErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, audience })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const email = await staffEmail()
  if (email === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params

  const { error } = await supabaseAdmin
    .from('monthly_reports')
    .update({
      published_at:       null,
      published_audience: null,
      published_by_email: null,
    })
    .eq('id', id)
  if (error) {
    return NextResponse.json({ error: `Could not un-publish: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
