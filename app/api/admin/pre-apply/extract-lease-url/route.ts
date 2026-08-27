// POST /api/admin/pre-apply/extract-lease-url   { filename }
// Signed upload URL so the browser PUTs the lease straight to Supabase
// Storage, bypassing this Vercel function's request-body limit entirely —
// same reason /api/admin/pre-apply/[id]/upload-url exists (found live,
// MANXI 303's Purchase Agreement: Vercel's plain-text "Request Entity Too
// Large" body isn't JSON, so a client trying to parse it as JSON crashed).
// Reproduced here for the SAME reason on 2026-08-27 when extract-lease first
// tried to receive the raw file as multipart form data.
//
// Staged under intake/_staging/ because there's no application yet at this
// point in the "Open an application" form — extract-lease reads it from
// there and deletes it once done; it's never a real application's document.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: { filename?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const filename = String(b.filename ?? '')
  if (!ALLOWED.test(filename)) return NextResponse.json({ error: 'file must be a PDF or image' }, { status: 400 })
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `intake/_staging/${crypto.randomUUID()}_${safe}`

  const { data, error } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `could not create upload URL: ${error?.message ?? 'unknown'}` }, { status: 500 })
  return NextResponse.json({ bucket: INTAKE_BUCKET, path, token: data.token, signedUrl: data.signedUrl })
}
