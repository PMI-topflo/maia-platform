// GET /api/units/documents/[id]/preview[?assoc=CODE]
// Render an uploaded unit document as inline page images so staff, board,
// and on-site managers can eyeball what was submitted without downloading
// the raw file. Backs the click-to-preview popup on the unit-audit detail
// page (components/DocumentPreviewTrigger). The stored file lives in a
// PRIVATE bucket, so we mint a short-lived signed URL server-side and never
// hand it to the browser — the same host allow-list the applicant/board
// previews use (lib/document-preview) accepts it.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { urlToPreviewPages } from '@/lib/document-preview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'association-documents'
const SUPABASE_HOST_PREFIX = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const url = new URL(req.url)

  const auth = await resolveUnitsAuth(url.searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ pages: [], error: 'Unauthorized' }, { status: 401 })

  const { data: sub } = await supabaseAdmin.from('unit_document_submissions')
    .select('id, association_code, unit_ref, storage_key').eq('id', id).maybeSingle()
  if (!sub) return NextResponse.json({ pages: [], error: 'submission not found' }, { status: 404 })

  // Same-association + managed-unit scoping as the rest of the units portal:
  // a per-unit manager may only see the units they manage.
  if (sub.association_code !== auth.assoc) return NextResponse.json({ pages: [], error: 'forbidden' }, { status: 403 })
  if (auth.managedUnits && !auth.managedUnits.includes(sub.unit_ref)) {
    return NextResponse.json({ pages: [], error: 'forbidden' }, { status: 403 })
  }
  if (!sub.storage_key) return NextResponse.json({ pages: [], error: 'no file on this submission' }, { status: 404 })

  const { data: signed, error: sErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(sub.storage_key, 300)
  if (sErr || !signed?.signedUrl) return NextResponse.json({ pages: [], error: 'could not open file' }, { status: 500 })

  // createSignedUrl may return an absolute URL or a "/storage/..."-relative
  // path depending on the client version; normalize so it passes the host
  // allow-list in lib/document-preview.
  const signedUrl = signed.signedUrl.startsWith('http') ? signed.signedUrl : `${SUPABASE_HOST_PREFIX}${signed.signedUrl}`

  return NextResponse.json({ pages: await urlToPreviewPages(signedUrl) })
}
