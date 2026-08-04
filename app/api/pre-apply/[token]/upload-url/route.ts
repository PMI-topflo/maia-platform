// POST /api/pre-apply/[token]/upload-url   { doc_key, filename }
// Signed upload URL so the applicant PUTs an intake document straight to the
// private application-docs bucket. Token is the auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPreApplyToken } from '@/lib/preapply-token'
import { getIntake, INTAKE_BUCKET } from '@/lib/preapply'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyPreApplyToken(token)
  if (!t) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(t.applicationId)
  if (!intake) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (intake.submittedAt) return NextResponse.json({ error: 'This application has already been submitted.' }, { status: 400 })

  let b: { doc_key?: string; filename?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim().replace(/[^\w-]+/g, '_')
  if (!docKey) return NextResponse.json({ error: 'doc_key required' }, { status: 400 })
  const safe = String(b.filename ?? 'upload').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `intake/${t.applicationId}/${docKey}/${crypto.randomUUID()}_${safe}`

  const { data, error } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `could not create upload URL: ${error?.message ?? 'unknown'}` }, { status: 500 })
  return NextResponse.json({ bucket: INTAKE_BUCKET, path, token: data.token, signedUrl: data.signedUrl })
}
