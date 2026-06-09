// POST /api/admin/documents/validate — the smart-upload gate. Reads an
// uploaded staging file and validates it against an expected spec_key,
// returning an approved/invalid verdict + reason. Staff-only.
// Body: { storage_path, spec_key, mime_type?, bucket? }
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeUpload } from '@/lib/pdf-normalize'
import { validateDocument } from '@/lib/document-validation'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { storage_path?: string; spec_key?: string; mime_type?: string; bucket?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const storagePath = (body.storage_path ?? '').trim()
  const specKey = (body.spec_key ?? 'generic').trim()
  const bucket = (body.bucket ?? 'association-documents').trim()
  if (!storagePath) return NextResponse.json({ error: 'storage_path is required' }, { status: 400 })

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: `storage download failed: ${dlErr?.message ?? 'no blob'}` }, { status: 500 })
  const raw  = Buffer.from(await blob.arrayBuffer())
  const norm = await normalizeUpload(raw, { contentType: body.mime_type ?? null, filename: storagePath.split('/').pop() ?? null }).catch(() => null)

  try {
    const result = await validateDocument(norm?.buffer ?? raw, body.mime_type ?? null, specKey)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: `validation failed: ${(err as Error).message}` }, { status: 502 })
  }
}
