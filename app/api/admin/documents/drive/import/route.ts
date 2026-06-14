// =====================================================================
// POST /api/admin/documents/drive/import  { fileId, name, mimeType, path? }
// Pull one file from the shared Drive folder, stage it in the inbox bucket,
// and run it through the MAIA intake pipeline (classify → split → file rows).
// The folder breadcrumb is passed as a classification hint. Staff-only.
// Returns the created review rows (same shape as the browser upload).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { downloadDriveFile } from '@/lib/drive-import'
import { ingestStagedDocument } from '@/lib/document-intake-ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BUCKET = 'association-documents'
const MAX_BYTES = 30 * 1024 * 1024

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  let body: { fileId?: string; name?: string; mimeType?: string; path?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const fileId = String(body.fileId ?? '').trim()
  const name = String(body.name ?? 'document').trim()
  const mimeType = String(body.mimeType ?? 'application/pdf')
  if (!fileId) return NextResponse.json({ error: 'fileId is required' }, { status: 400 })

  // Download from Drive.
  let bytes: Buffer
  try { bytes = await downloadDriveFile(fileId) }
  catch (e) { return NextResponse.json({ error: `Drive download failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 }) }
  if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: `${name} is over 30 MB — import it manually.` }, { status: 400 })

  // Stage it in the inbox bucket so the shared ingest can read it.
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  const storagePath = `_inbox/drive-${fileId}-${safe}${/\.(pdf|jpe?g|png|webp|heic|tiff)$/i.test(safe) ? '' : '.pdf'}`
  const up = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, bytes, { contentType: mimeType, upsert: true })
  if (up.error) return NextResponse.json({ error: `staging failed: ${up.error.message}` }, { status: 500 })

  const res = await ingestStagedDocument({
    storagePath, filename: name, mimeType, uploadedBy: me,
    contextHint: body.path ? String(body.path) : null,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ rows: res.rows, split: res.split })
}
