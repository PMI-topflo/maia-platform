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
import { normalizeUpload } from '@/lib/pdf-normalize'
import { classifyDocument, type AssociationRef } from '@/lib/document-classifier'
import { matchOwnerInAssociation } from '@/lib/owner-match'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BUCKET = 'association-documents'
const SELECT = 'id, storage_path, filename, mime_type, status, suggested_association_code, suggested_category, suggested_item_key, suggested_scope, suggested_unit_ref, suggested_unit_label, doc_type, effective_date, expiration_date, confidence, summary, model, created_at'

async function requireStaff() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}
const actor = (s: { userId: string | number }) => typeof s.userId === 'string' && s.userId.includes('@') ? s.userId.toLowerCase() : null

export async function GET(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const status = new URL(req.url).searchParams.get('status') ?? 'review'
  const { data, error } = await supabaseAdmin.from('document_intake').select(SELECT).eq('status', status).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ rows: [], error: error.message })
  return NextResponse.json({ rows: data ?? [] })
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { storage_path?: string; filename?: string; mime_type?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const storagePath = (body.storage_path ?? '').trim()
  if (!storagePath.startsWith('_inbox/')) return NextResponse.json({ error: 'storage_path must be an inbox staging path' }, { status: 400 })

  // association list for matching
  const { data: assocRows } = await supabaseAdmin.from('associations').select('association_code, association_name').order('association_name')
  const assocs: AssociationRef[] = (assocRows ?? []).map(a => ({ code: String(a.association_code), name: String(a.association_name ?? a.association_code) }))

  // download + normalize + classify
  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: `storage download failed: ${dlErr?.message ?? 'no blob'}` }, { status: 500 })
  const raw  = Buffer.from(await blob.arrayBuffer())
  const norm = await normalizeUpload(raw, { contentType: body.mime_type ?? null, filename: body.filename ?? null }).catch(() => null)
  const buf  = norm?.buffer ?? raw

  let cls
  try { cls = await classifyDocument(buf, body.mime_type ?? null, assocs) }
  catch (err) { return NextResponse.json({ error: `classification failed: ${(err as Error).message}` }, { status: 502 }) }

  // For a unit-level doc with a known association, try to match the owner MAIA
  // read so the row pre-selects the right unit; staff can still change it.
  let unitRef: string | null = null
  let unitLabel: string | null = null
  if (cls.scope === 'unit' && cls.association_code) {
    const owner = await matchOwnerInAssociation(cls.association_code, cls.unit_seen).catch(() => null)
    if (owner) { unitRef = owner.account_number; unitLabel = owner.label }
    else if (cls.unit_seen) unitLabel = cls.unit_seen   // show what MAIA read so staff can find the owner
  }

  const { data: row, error } = await supabaseAdmin.from('document_intake').insert({
    storage_path: storagePath, filename: body.filename ?? null, mime_type: body.mime_type ?? null, status: 'review',
    suggested_association_code: cls.association_code, suggested_category: cls.category, suggested_item_key: cls.item_key,
    suggested_scope: cls.scope, suggested_unit_ref: unitRef, suggested_unit_label: unitLabel,
    doc_type: cls.doc_type, effective_date: cls.effective_date, expiration_date: cls.expiration_date,
    confidence: cls.confidence, summary: cls.summary, model: cls.model, uploaded_by: actor(session),
  }).select(SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ row })
}
