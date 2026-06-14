// =====================================================================
// GET  /api/admin/documents/inbox            → review queue (+ ?status=)
// POST /api/admin/documents/inbox            → classify a just-uploaded
//      file and create its intake row. Body: { storage_path, filename, mime_type }
// MAIA Document Inbox. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ingestStagedDocument, INTAKE_SELECT } from '@/lib/document-intake-ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function requireStaff() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}
const actor = (s: { userId: string | number }) => typeof s.userId === 'string' && s.userId.includes('@') ? s.userId.toLowerCase() : null

export async function GET(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const status = new URL(req.url).searchParams.get('status') ?? 'review'
  const { data, error } = await supabaseAdmin.from('document_intake').select(INTAKE_SELECT).eq('status', status).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ rows: [], error: error.message })
  return NextResponse.json({ rows: data ?? [] })
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { storage_path?: string; filename?: string; mime_type?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const res = await ingestStagedDocument({
    storagePath: (body.storage_path ?? '').trim(),
    filename: body.filename ?? null,
    mimeType: body.mime_type ?? null,
    uploadedBy: actor(session),
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ rows: res.rows, split: res.split })
}
