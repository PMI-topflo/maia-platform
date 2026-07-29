// POST /api/admin/board-members/certification/upload-url  { code, memberId, filename }
// Signed one-time URL so the browser PUTs the certificate straight to
// Supabase Storage (bypasses Vercel's 4.5 MB body limit). Staff-only; the
// server picks the path. The metadata POST to ../certification follows.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'

export const dynamic = 'force-dynamic'
const BUCKET = 'association-documents'

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string; memberId?: string; filename?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code    = String(body.code ?? '').trim().toUpperCase()
  const memberId = String(body.memberId ?? '').trim()
  if (!code || !memberId) return NextResponse.json({ error: 'code, memberId required' }, { status: 400 })

  const safe = String(body.filename ?? 'certificate').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `board-certifications/${code}/${memberId}/${crypto.randomUUID()}_${safe}`

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `could not create upload URL: ${error?.message ?? 'unknown'}` }, { status: 500 })

  return NextResponse.json({ bucket: BUCKET, path, token: data.token, signedUrl: data.signedUrl })
}
