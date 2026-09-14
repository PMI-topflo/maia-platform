// GET /api/application-audit/[token]  → the Processing audit behind a share link.
// Public: the link is the credential (same precedent as /request/[token]).
// Counts the view. Revoked links answer 404.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildProcessingAudit } from '@/lib/application-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  const { data: link } = await supabaseAdmin.from('application_audit_links').select('id, application_id, view_count, revoked_at').eq('id', token).maybeSingle()
  if (!link || link.revoked_at) return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 })
  const audit = await buildProcessingAudit(String(link.application_id))
  if (!audit) return NextResponse.json({ error: 'This application is no longer available.' }, { status: 404 })
  await supabaseAdmin.from('application_audit_links').update({ view_count: Number(link.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', link.id).then(() => null, () => null)
  // The public card never carries the per-file list (document names of a
  // private application) — only the six facts and the phases.
  const { files: _files, ...pub } = audit
  void _files
  return NextResponse.json({ audit: pub })
}
