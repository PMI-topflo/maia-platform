// POST /api/units/board-certifications/upload-url  { memberId, filename, assoc }
// Signed upload URL so an on-site manager / board member on the /units audit
// can upload a board-education certificate for a member of their association.
// Server picks the path; the /submit metadata POST follows once the file lands.
// Requires units upload permission (board / staff / manager with can_upload).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'

export const dynamic = 'force-dynamic'
const BUCKET = 'association-documents'

export async function POST(req: Request) {
  let body: { memberId?: string; filename?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canUpload) return NextResponse.json({ error: 'You do not have upload permission for this association.' }, { status: 403 })

  const memberId = String(body.memberId ?? '').trim()
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  // The board member must belong to the caller's association.
  const { data: member } = await supabaseAdmin.from('association_board_members')
    .select('id, association_code').eq('id', memberId).maybeSingle()
  if (!member || member.association_code.toUpperCase() !== auth.assoc.toUpperCase()) {
    return NextResponse.json({ error: 'board member not found for this association' }, { status: 404 })
  }

  const safe = String(body.filename ?? 'upload').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `board-certifications/${auth.assoc}/${memberId}/${crypto.randomUUID()}_${safe}`

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `could not create upload URL: ${error?.message ?? 'unknown'}` }, { status: 500 })

  return NextResponse.json({ bucket: BUCKET, path, token: data.token, signedUrl: data.signedUrl })
}
