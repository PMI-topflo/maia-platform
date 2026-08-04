// POST /api/esign/[token]/upload-url   { filename }
// Signed upload URL for a fillable e-sign form (e.g. a pet vaccination record).
// The browser PUTs the file directly to storage; the /fill payload then
// references the returned path. Token is the auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyEsignToken } from '@/lib/esign-token'
import { getEsignDoc, roleSigned } from '@/lib/esign'

export const dynamic = 'force-dynamic'
const BUCKET = 'association-documents'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyEsignToken(token)
  if (!t) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const doc = await getEsignDoc(t.docId)
  if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (doc.status === 'void' || roleSigned(doc, t.role)) return NextResponse.json({ error: 'This document can no longer be edited.' }, { status: 400 })

  let body: { filename?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const safe = String(body.filename ?? 'upload').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `esign/${t.docId}/${crypto.randomUUID()}_${safe}`

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `could not create upload URL: ${error?.message ?? 'unknown'}` }, { status: 500 })
  return NextResponse.json({ bucket: BUCKET, path, token: data.token, signedUrl: data.signedUrl })
}
