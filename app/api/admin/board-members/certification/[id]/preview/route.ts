// GET /api/admin/board-members/certification/[id]/preview
// Render a board-certification document as inline page images (staff-only).
// Signs the private association-documents bucket path server-side, same as
// the unit-audit document preview. Backs the click-to-preview popup.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { urlToPreviewPages } from '@/lib/document-preview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'association-documents'
const SUPABASE_HOST_PREFIX = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ pages: [], error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: cert } = await supabaseAdmin.from('board_member_certifications')
    .select('id, storage_key').eq('id', id).maybeSingle()
  if (!cert?.storage_key) return NextResponse.json({ pages: [], error: 'no file' }, { status: 404 })

  const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(cert.storage_key, 300)
  if (error || !signed?.signedUrl) return NextResponse.json({ pages: [], error: 'could not open file' }, { status: 500 })

  const signedUrl = signed.signedUrl.startsWith('http') ? signed.signedUrl : `${SUPABASE_HOST_PREFIX}${signed.signedUrl}`
  return NextResponse.json({ pages: await urlToPreviewPages(signedUrl) })
}
