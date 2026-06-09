// =====================================================================
// app/api/admin/associations/[code]/insurance/extract/route.ts
// POST — read a MASTER insurance declaration and split it into per-coverage
// rows for the Insurance manager to review before applying. Staff-only.
//
// Body: { storage_path: string, mime_type?: string }
// The browser uploads the dec page via the signed-URL route first, then
// calls this with the returned storage_path. Returns coverages[] +
// confidence; nothing is written — the staffer reviews and applies.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeUpload } from '@/lib/pdf-normalize'
import { extractInsuranceDeclaration } from '@/lib/insurance-declaration-extraction'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const STORAGE_BUCKET = 'association-documents'

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const upperCode = (code ?? '').trim().toUpperCase()

  let body: { storage_path?: string; mime_type?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const storagePath = (body.storage_path ?? '').trim()
  if (!storagePath) return NextResponse.json({ error: 'storage_path is required' }, { status: 400 })
  if (!storagePath.startsWith(`${upperCode}/`)) {
    return NextResponse.json({ error: 'storage_path does not belong to this association' }, { status: 400 })
  }

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: `storage download failed: ${dlErr?.message ?? 'no blob'}` }, { status: 500 })

  const raw  = Buffer.from(await blob.arrayBuffer())
  const norm = await normalizeUpload(raw, { contentType: body.mime_type ?? null, filename: storagePath.split('/').pop() ?? null }).catch(() => null)
  const buf  = norm?.buffer ?? raw

  try {
    const result = await extractInsuranceDeclaration(buf, body.mime_type ?? null)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: `extraction failed: ${(err as Error).message}` }, { status: 502 })
  }
}
