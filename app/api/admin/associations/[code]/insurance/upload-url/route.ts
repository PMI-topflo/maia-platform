// =====================================================================
// /api/admin/associations/[code]/insurance/upload-url
//
// Returns a one-time signed upload URL so the browser can PUT a COI /
// policy PDF DIRECTLY to Supabase Storage (bypassing Vercel's 4.5 MB
// serverless body limit), then POST the returned storage_path back to
// the /insurance endpoint as coi_storage_path.
//
// Mirrors the documents upload-url route. Files land under
// <CODE>/insurance/<policy_type>/... in the shared association-documents
// bucket. The server picks the path so a client can't escape the assoc
// folder. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { INSURANCE_COI_BUCKET, POLICY_TYPE_KEYS } from '@/lib/association-insurance'

export const dynamic = 'force-dynamic'

interface Body {
  filename?:    string
  policy_type?: string
}

let _bucketEnsured = false
async function ensureBucket(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (_bucketEnsured) return { ok: true }
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets()
  if (listErr) return { ok: false, reason: `listBuckets failed: ${listErr.message}` }
  if (buckets?.some(b => b.name === INSURANCE_COI_BUCKET)) {
    _bucketEnsured = true
    return { ok: true }
  }
  const { error: createErr } = await supabaseAdmin.storage.createBucket(INSURANCE_COI_BUCKET, {
    public:        false,
    fileSizeLimit: 50 * 1024 * 1024,
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

  const rawType = (body.policy_type ?? '').trim()
  const policyType = POLICY_TYPE_KEYS.has(rawType) ? rawType : 'other'

  const bucketCheck = await ensureBucket()
  if (!bucketCheck.ok) {
    return NextResponse.json(
      {
        error: `Storage bucket "${INSURANCE_COI_BUCKET}" is not ready: ${bucketCheck.reason}. ` +
               `Create it manually in Supabase → Storage (NOT public, 50 MB file limit) and retry.`,
      },
      { status: 500 },
    )
  }

  const safeName = filename.replace(/[^\w\-.]/g, '_').slice(0, 120)
  const storagePath = `${upperCode}/insurance/${policyType}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`

  const { data, error } = await supabaseAdmin.storage
    .from(INSURANCE_COI_BUCKET)
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
