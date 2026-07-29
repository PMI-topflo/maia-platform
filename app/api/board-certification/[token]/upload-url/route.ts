// POST /api/board-certification/[token]/upload-url  { filename }
// Signed one-time URL for the login-free board-member self-upload. Token is
// the auth; the server picks the path (scoped to the member's folder).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyBoardCertToken } from '@/lib/board-cert-token'

export const dynamic = 'force-dynamic'
const BUCKET = 'association-documents'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyBoardCertToken(token)
  if (!data) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: { filename?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const safe = String(body.filename ?? 'certificate').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `board-certifications/${data.assoc}/${data.memberId}/${crypto.randomUUID()}_${safe}`

  const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !signed) return NextResponse.json({ error: `could not create upload URL: ${error?.message ?? 'unknown'}` }, { status: 500 })

  return NextResponse.json({ bucket: BUCKET, path, token: signed.token, signedUrl: signed.signedUrl })
}
