// GET  /api/admin/pre-apply/[id]/audit  → the Processing audit + existing share links (staff)
// POST /api/admin/pre-apply/[id]/audit  → create a share link; returns its public URL (staff)

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { staffLabel } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildProcessingAudit } from '@/lib/application-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

async function staff() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await staff()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const [audit, { data: links }] = await Promise.all([
    buildProcessingAudit(id),
    supabaseAdmin.from('application_audit_links').select('id, created_by, created_at, view_count, last_viewed_at').eq('application_id', id).is('revoked_at', null).order('created_at', { ascending: false })
      .then(r => r, () => ({ data: [] as unknown[] })),
  ])
  if (!audit) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ audit, links: ((links ?? []) as { id: string; created_by: string | null; created_at: string; view_count: number; last_viewed_at: string | null }[]).map(l => ({ ...l, url: `${APP}/application-audit/${l.id}` })) })
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await staff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const { data, error } = await supabaseAdmin.from('application_audit_links')
    .insert({ application_id: id, created_by: staffLabel(session) }).select('id, created_at').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'could not create the link (is the application_audit_links migration applied?)' }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id, url: `${APP}/application-audit/${data.id}`, createdAt: data.created_at })
}
