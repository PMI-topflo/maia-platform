// =====================================================================
// app/api/admin/associations/[code]/compliance-extract/route.ts
// POST — read deadline dates off a just-uploaded compliance document so
// the Insurance / Safety managers can PRE-FILL the due-date field for the
// staffer to confirm. Staff-only.
//
// Body: { storage_path: string, kind: 'insurance' | 'safety', mime_type?: string }
// The browser uploads the file via the signed-URL route first, then calls
// this with the returned storage_path. Returns the extracted dates +
// confidence; the staffer always reviews before saving.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeUpload } from '@/lib/pdf-normalize'
import { extractComplianceDates, type ComplianceKind } from '@/lib/compliance-extraction'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STORAGE_BUCKET = 'association-documents'

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const upperCode = (code ?? '').trim().toUpperCase()

  let body: { storage_path?: string; kind?: string; mime_type?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const storagePath = (body.storage_path ?? '').trim()
  const kind = body.kind as ComplianceKind
  if (!storagePath || (kind !== 'insurance' && kind !== 'safety')) {
    return NextResponse.json({ error: 'storage_path and kind (insurance|safety) are required' }, { status: 400 })
  }
  // Defense in depth: the path must live under this association's folder.
  if (!storagePath.startsWith(`${upperCode}/`)) {
    return NextResponse.json({ error: 'storage_path does not belong to this association' }, { status: 400 })
  }

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: `storage download failed: ${dlErr?.message ?? 'no blob'}` }, { status: 500 })

  const raw = Buffer.from(await blob.arrayBuffer())
  // Compress first so a 20 MB phone scan stays well within the model's input
  // limits (and is fast). Best-effort — falls back to the original.
  const norm = await normalizeUpload(raw, { contentType: body.mime_type ?? null, filename: storagePath.split('/').pop() ?? null }).catch(() => null)
  const buf  = norm?.buffer ?? raw

  try {
    const result = await extractComplianceDates(buf, kind, body.mime_type ?? null)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: `extraction failed: ${(err as Error).message}` }, { status: 502 })
  }
}
