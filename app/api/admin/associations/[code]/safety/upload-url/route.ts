// =====================================================================
// /api/admin/associations/[code]/safety/upload-url
//
// One-time signed upload URL so the browser PUTs a report PDF directly
// to Supabase Storage (bypassing Vercel's body limit), then POSTs the
// returned storage_path back to /safety as report_storage_path. Files
// land under <CODE>/safety/<inspection_type>/... in the shared
// association-documents bucket. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SAFETY_REPORT_BUCKET, INSPECTION_TYPE_KEYS } from '@/lib/association-safety'

export const dynamic = 'force-dynamic'

interface Body { filename?: string; inspection_type?: string }

let _bucketEnsured = false
async function ensureBucket(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (_bucketEnsured) return { ok: true }
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets()
  if (listErr) return { ok: false, reason: `listBuckets failed: ${listErr.message}` }
  if (buckets?.some(b => b.name === SAFETY_REPORT_BUCKET)) { _bucketEnsured = true; return { ok: true } }
  const { error: createErr } = await supabaseAdmin.storage.createBucket(SAFETY_REPORT_BUCKET, {
    public: false, fileSizeLimit: 50 * 1024 * 1024,
  })
  if (createErr) return { ok: false, reason: `createBucket failed: ${createErr.message}` }
  _bucketEnsured = true
  return { ok: true }
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { code } = await ctx.params
  const upperCode = code.toUpperCase()

  let body: Body
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const filename = (body.filename ?? '').trim()
  if (!filename) return NextResponse.json({ error: 'filename is required' }, { status: 400 })

  const rawType = (body.inspection_type ?? '').trim()
  const inspectionType = INSPECTION_TYPE_KEYS.has(rawType) ? rawType : 'other'

  const bucketCheck = await ensureBucket()
  if (!bucketCheck.ok) {
    return NextResponse.json(
      { error: `Storage bucket "${SAFETY_REPORT_BUCKET}" is not ready: ${bucketCheck.reason}.` },
      { status: 500 },
    )
  }

  const safeName = filename.replace(/[^\w\-.]/g, '_').slice(0, 120)
  const storagePath = `${upperCode}/safety/${inspectionType}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`

  const { data, error } = await supabaseAdmin.storage
    .from(SAFETY_REPORT_BUCKET)
    .createSignedUploadUrl(storagePath)

  if (error || !data?.signedUrl || !data?.token) {
    return NextResponse.json(
      { error: `Could not generate upload URL: ${error?.message ?? 'no token returned'}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ storage_path: storagePath, token: data.token, signed_url: data.signedUrl })
}
