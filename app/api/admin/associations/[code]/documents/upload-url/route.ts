// =====================================================================
// /api/admin/associations/[code]/documents/upload-url
//
// Returns a one-time signed upload URL for the association-documents
// bucket so the browser can PUT the file DIRECTLY to Supabase Storage,
// bypassing Vercel's 4.5 MB serverless function body limit. After the
// upload completes, the client POSTs metadata to the regular
// /documents endpoint with source='upload_complete' and the
// storage_path returned here.
//
// Staff-only. The endpoint generates the storage path itself
// (UUID + sanitized filename) so the client can't pick paths that
// would clobber other associations' docs or escape the assoc folder.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { STORAGE_BUCKET, CATEGORY_KEYS } from '@/lib/association-documents'

export const dynamic = 'force-dynamic'

interface Body {
  filename?:  string
  category?:  string
}

// Mirrors the bucket bootstrap in the main documents route so callers
// hitting upload-url on a fresh environment don't fail with "bucket not
// found". listBuckets() is a cheap call; the create is no-op when the
// bucket already exists.
let _bucketEnsured = false
async function ensureBucket(): Promise<void> {
  if (_bucketEnsured) return
  const { data: buckets } = await supabaseAdmin.storage.listBuckets()
  if (!buckets?.some(b => b.name === STORAGE_BUCKET)) {
    await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
      public:        false,
      fileSizeLimit: 50 * 1024 * 1024,
    })
  }
  _bucketEnsured = true
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
  if (!filename) {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 })
  }
  const category = (body.category ?? '').trim().toLowerCase()
  const safeCategory = CATEGORY_KEYS.has(category) ? category : 'other'

  await ensureBucket()

  const safeName = filename.replace(/[^\w\-.]/g, '_').slice(0, 120)
  const storagePath = `${upperCode}/${safeCategory}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath)

  if (error || !data?.signedUrl || !data?.token) {
    return NextResponse.json(
      { error: `Could not generate upload URL: ${error?.message ?? 'no token returned'}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    storage_path: storagePath,
    token:        data.token,
    signed_url:   data.signedUrl,
  })
}
