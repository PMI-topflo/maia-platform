// =====================================================================
// /api/admin/associations/[code]/documents
//
// GET  → list every association_documents row for this association,
//        newest first, grouped by category in the response.
// POST → either:
//        - multipart/form-data with a `file` field (upload to Supabase
//          storage, extract text if PDF, insert DB row)
//        - application/json (add a Drive link or plain-text note)
//
// All paths are staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  STORAGE_BUCKET,
  CATEGORY_KEYS,
  isExtractableMime,
  type AssociationDocument,
  type DocumentSource,
} from '@/lib/association-documents'
import { extractPdfText } from '@/lib/extract-pdf'

export const dynamic = 'force-dynamic'

// Generous because PDF parsing is CPU-bound + storage upload is I/O.
// Vercel default is 300s; we don't need to override unless we see
// timeouts in practice.
export const maxDuration = 300

// ─────────────────────────────────────────────────────────────────────
// Storage bucket bootstrap — same defensive create-if-missing pattern
// the buyer-notification route uses so the first staff upload doesn't
// require a manual setup step on a fresh environment.
// ─────────────────────────────────────────────────────────────────────
let _bucketEnsured = false
async function ensureBucket(): Promise<void> {
  if (_bucketEnsured) return
  const { data: buckets } = await supabaseAdmin.storage.listBuckets()
  if (!buckets?.some(b => b.name === STORAGE_BUCKET)) {
    await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      // 50 MB cap matches what most association docs need (master
      // policy PDFs run 5–30 MB). Larger uploads should be Drive links.
      fileSizeLimit: 50 * 1024 * 1024,
    })
  }
  _bucketEnsured = true
}

async function requireStaff() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return session
}

function normalizeCategory(raw: string | null | undefined): string {
  const c = (raw ?? '').trim().toLowerCase()
  return CATEGORY_KEYS.has(c) ? c : 'other'
}

function actorEmail(session: { userId: string | number }): string | null {
  return typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : null
}

// ─────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const { data, error } = await supabaseAdmin
    .from('association_documents')
    .select('*')
    .eq('association_code', code.toUpperCase())
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Don't ship extracted_text on the list endpoint — it can be
  // megabytes per row and the listing page only needs metadata. The
  // chat handler queries it directly when it needs the text.
  const list = ((data ?? []) as AssociationDocument[]).map(d => ({ ...d, extracted_text: null }))
  return NextResponse.json({ documents: list })
}

// ─────────────────────────────────────────────────────────────────────
// POST — handles BOTH file uploads (multipart) and link/note rows (JSON)
// ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const upperCode = code.toUpperCase()
  const contentType = req.headers.get('content-type') ?? ''

  // ── Multipart: a file upload ──────────────────────────────────────
  if (contentType.startsWith('multipart/form-data')) {
    let form: FormData
    try { form = await req.formData() }
    catch { return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 }) }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file field' }, { status: 400 })
    }

    const category    = normalizeCategory(form.get('category')?.toString())
    const subcategory = form.get('subcategory')?.toString().trim() || null
    const notes       = form.get('notes')?.toString().trim() || null
    const effective   = form.get('effective_date')?.toString().trim() || null
    const expiry      = form.get('expiry_date')?.toString().trim() || null

    await ensureBucket()

    // Stable, collision-resistant storage path so concurrent uploads
    // of identically-named files don't overwrite each other.
    const buffer = Buffer.from(await file.arrayBuffer())
    const safeName = file.name.replace(/[^\w\-.]/g, '_').slice(0, 120)
    const storagePath = `${upperCode}/${category}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert:      false,
      })
    if (uploadErr) {
      return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 })
    }

    // Extract text inline. For non-PDFs the helper returns 'skipped'
    // so the DB row records the file but extracted_text stays NULL.
    const extractable = isExtractableMime(file.type, file.name)
    const extraction = extractable
      ? await extractPdfText(buffer, file.type)
      : { status: 'unsupported' as const, text: null, pages: null, error: null }

    const insertRow = {
      association_code:  upperCode,
      category,
      subcategory,
      source:            'upload' as DocumentSource,
      storage_path:      storagePath,
      drive_url:         null,
      filename:          file.name,
      mime_type:         file.type || null,
      file_size_bytes:   buffer.byteLength,
      extracted_text:    extraction.text,
      extraction_status: extraction.status,
      extraction_error:  extraction.error,
      effective_date:    effective || null,
      expiry_date:       expiry || null,
      notes,
      uploaded_by_email: actorEmail(session),
    }

    const { data: inserted, error: dbErr } = await supabaseAdmin
      .from('association_documents')
      .insert(insertRow)
      .select('*')
      .single()
    if (dbErr) {
      // Roll back the storage object so we don't leak an orphan file.
      await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {})
      return NextResponse.json({ error: `DB insert failed: ${dbErr.message}` }, { status: 500 })
    }

    // Don't echo extracted_text back — same rationale as GET.
    return NextResponse.json({
      ok:       true,
      document: { ...inserted, extracted_text: null },
      pages:    extraction.pages,
    })
  }

  // ── JSON: drive link or note ──────────────────────────────────────
  let body: {
    source?:         DocumentSource
    category?:       string
    subcategory?:    string | null
    drive_url?:      string | null
    filename?:       string
    notes?:          string | null
    effective_date?: string | null
    expiry_date?:    string | null
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const source = body.source === 'note' ? 'note' : 'drive_link'

  if (source === 'drive_link') {
    if (!body.drive_url?.trim()) {
      return NextResponse.json({ error: 'drive_url is required' }, { status: 400 })
    }
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('association_documents')
    .insert({
      association_code:  upperCode,
      category:          normalizeCategory(body.category),
      subcategory:       body.subcategory?.trim() || null,
      source,
      storage_path:      null,
      drive_url:         body.drive_url?.trim() || null,
      filename:          body.filename?.trim() || (source === 'drive_link' ? 'Drive link' : 'Note'),
      mime_type:         null,
      file_size_bytes:   null,
      extracted_text:    null,
      // 'unsupported' is the honest status — we have no way to extract
      // text from a Drive URL today. Notes get 'done' because their
      // text IS the notes field; we surface it to MAIA the same way.
      extraction_status: source === 'note' ? 'done' : 'unsupported',
      extraction_error:  null,
      effective_date:    body.effective_date || null,
      expiry_date:       body.expiry_date || null,
      notes:             body.notes?.trim() || null,
      uploaded_by_email: actorEmail(session),
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, document: { ...inserted, extracted_text: null } })
}
