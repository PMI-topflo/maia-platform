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
import { pdfPageCount, splitPdfRange } from '@/lib/pdf-split'

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

  // download + normalize + classify. Use the SAME buffer for page count + any
  // split as we send to Claude, so the model's page numbers line up.
  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: `storage download failed: ${dlErr?.message ?? 'no blob'}` }, { status: 500 })
  const raw  = Buffer.from(await blob.arrayBuffer())
  const norm = await normalizeUpload(raw, { contentType: body.mime_type ?? null, filename: body.filename ?? null }).catch(() => null)
  const buf  = norm?.buffer ?? raw
  const pageCount = await pdfPageCount(buf)

  let cls
  try { cls = await classifyDocument(buf, body.mime_type ?? null, assocs, pageCount) }
  catch (err) { return NextResponse.json({ error: `classification failed: ${(err as Error).message}` }, { status: 502 }) }

  // A packet can bundle several policies. File one intake row per detected
  // item; when there's more than one and we have its page range, split the PDF
  // so each policy gets its own file. If MAIA found nothing, keep one row so
  // staff can classify the file by hand.
  const detected = cls.items.length > 0
    ? cls.items
    : [{ scope: 'association' as const, unit_seen: null, category: null, item_key: null, doc_type: null, effective_date: null, expiration_date: null, page_start: null, page_end: null, confidence: cls.confidence }]
  const multi = detected.length > 1

  const inserts: Record<string, unknown>[] = []
  for (let i = 0; i < detected.length; i++) {
    const it = detected[i]
    let path = storagePath

    // Split this policy into its own file (best-effort; falls back to the full
    // packet if the range is missing or splitting fails).
    if (multi && pageCount > 1 && it.page_start && it.page_end) {
      const part = await splitPdfRange(buf, it.page_start, it.page_end).catch(() => null)
      if (part) {
        const slug = (it.item_key ?? `part${i + 1}`).replace(/[^a-z0-9]+/gi, '_')
        const splitPath = `${storagePath.replace(/\.pdf$/i, '')}__${slug}_p${it.page_start}-${it.page_end}.pdf`
        const up = await supabaseAdmin.storage.from(BUCKET).upload(splitPath, part, { contentType: 'application/pdf', upsert: true })
        if (!up.error) path = splitPath
      }
    }

    // Owner match for unit-scope items.
    let unitRef: string | null = null
    let unitLabel: string | null = null
    if (it.scope === 'unit' && cls.association_code) {
      const owner = await matchOwnerInAssociation(cls.association_code, it.unit_seen).catch(() => null)
      if (owner) { unitRef = owner.account_number; unitLabel = owner.label }
      else if (it.unit_seen) unitLabel = it.unit_seen
    }

    const partName = multi && it.doc_type ? `${body.filename ?? 'document'} — ${it.doc_type}` : (body.filename ?? null)
    inserts.push({
      storage_path: path, filename: partName, mime_type: 'application/pdf', status: 'review',
      suggested_association_code: cls.association_code, suggested_category: it.category, suggested_item_key: it.item_key,
      suggested_scope: it.scope, suggested_unit_ref: unitRef, suggested_unit_label: unitLabel,
      doc_type: it.doc_type, effective_date: it.effective_date, expiration_date: it.expiration_date,
      confidence: it.confidence || cls.confidence, summary: cls.summary, model: cls.model, uploaded_by: actor(session),
    })
  }

  const { data: rows, error } = await supabaseAdmin.from('document_intake').insert(inserts).select(SELECT)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: rows ?? [], split: multi })
}
