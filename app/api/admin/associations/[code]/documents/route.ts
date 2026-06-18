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
import { normalizeUpload } from '@/lib/pdf-normalize'
import { normalizeStoredFile } from '@/lib/normalize-stored-file'

export const dynamic = 'force-dynamic'

// Generous because PDF parsing is CPU-bound + storage upload is I/O.
// Vercel default is 300s; we don't need to override unless we see
// timeouts in practice.
export const maxDuration = 300

// ─────────────────────────────────────────────────────────────────────
// Storage bucket bootstrap — defensive create-if-missing. The cached
// _bucketEnsured flag flips to true ONLY after we've confirmed the
// bucket actually exists, so a silent createBucket failure doesn't
// poison subsequent calls.
// ─────────────────────────────────────────────────────────────────────
let _bucketEnsured = false
async function ensureBucket(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (_bucketEnsured) return { ok: true }

  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets()
  if (listErr) {
    return { ok: false, reason: `listBuckets failed: ${listErr.message}` }
  }
  if (buckets?.some(b => b.name === STORAGE_BUCKET)) {
    _bucketEnsured = true
    return { ok: true }
  }

  const { error: createErr } = await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
    public:        false,
    // 50 MB cap matches what most association docs need (master
    // policy PDFs run 5–30 MB).
    fileSizeLimit: 50 * 1024 * 1024,
  })
  if (createErr) {
    return { ok: false, reason: `createBucket failed: ${createErr.message}` }
  }
  _bucketEnsured = true
  return { ok: true }
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

// Normalize language code from upload form. Defaults to 'en' on
// missing / unrecognized values so legacy clients keep working without
// the field. Keep the allowed set tiny and aligned with the apply
// form's translation blocks.
const ALLOWED_LANGUAGES = new Set(['en', 'es', 'pt', 'fr', 'he', 'ru'])
function normalizeLanguage(raw: string | null | undefined): string {
  const l = (raw ?? '').trim().toLowerCase()
  return ALLOWED_LANGUAGES.has(l) ? l : 'en'
}

function actorEmail(session: { userId: string | number }): string | null {
  return typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : null
}

/** After a fresh upload for (assocCode, category, language), archive
 *  every other active row in the same (cat, lang) bucket so the new
 *  file is unambiguously the current version for that language.
 *  Different-language rows of the same category are LEFT ALONE — a
 *  Spanish Rules PDF doesn't supersede an English one. */
async function archivePriorActiveVersions(
  assocCode:    string,
  category:     string,
  language:     string,
  excludeId:    string,
  actorEmail:   string | null,
): Promise<void> {
  await supabaseAdmin
    .from('association_documents')
    .update({
      archived_at:       new Date().toISOString(),
      archived_by_email: actorEmail,
    })
    .eq('association_code', assocCode)
    .eq('category', category)
    .eq('language', language)
    .is('archived_at', null)
    .neq('id', excludeId)
}

// ─────────────────────────────────────────────────────────────────────
// GET
//
// Returns current (non-archived) rows by default. Pass
// ?include_archived=1 to also receive the version history rows so the
// UI can render a "Previous versions" expander.
// ─────────────────────────────────────────────────────────────────────
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const url = new URL(req.url)
  const includeArchived = url.searchParams.get('include_archived') === '1'

  let query = supabaseAdmin
    .from('association_documents')
    .select('*')
    .eq('association_code', code.toUpperCase())
    .order('created_at', { ascending: false })

  if (!includeArchived) {
    query = query.is('archived_at', null)
  }
  const { data, error } = await query

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
    const language    = normalizeLanguage(form.get('language')?.toString())
    const subcategory = form.get('subcategory')?.toString().trim() || null
    const notes       = form.get('notes')?.toString().trim() || null
    const effective   = form.get('effective_date')?.toString().trim() || null
    const expiry      = form.get('expiry_date')?.toString().trim() || null

    const bucketCheck = await ensureBucket()
    if (!bucketCheck.ok) {
      return NextResponse.json(
        { error: `Storage bucket "${STORAGE_BUCKET}" is not ready: ${bucketCheck.reason}` },
        { status: 500 },
      )
    }

    // Stable, collision-resistant storage path so concurrent uploads
    // of identically-named files don't overwrite each other.
    const raw = Buffer.from(await file.arrayBuffer())
    // Shrink oversized scans before storing + extracting; text PDFs and
    // small files pass through untouched.
    const { buffer } = await normalizeUpload(raw, { contentType: file.type, filename: file.name })
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
      language,
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

    // Auto-archive any prior active versions in this category so the
    // new upload is the unambiguous current. Skip when the row carries
    // no category (defensive — should always have one but the column
    // is text-typed, not enum).
    if (inserted?.id && category) {
      await archivePriorActiveVersions(upperCode, category, language, inserted.id, actorEmail(session))
    }

    // Don't echo extracted_text back — same rationale as GET.
    return NextResponse.json({
      ok:       true,
      document: { ...inserted, extracted_text: null },
      pages:    extraction.pages,
    })
  }

  // ── JSON: drive link, note, OR upload_complete ────────────────────
  // "upload_complete" is the metadata-only follow-up from the browser
  // after it uploaded the file DIRECTLY to Supabase Storage via a
  // signed upload URL. The browser sends storage_path + filename +
  // mime + size; we download the file ourselves (server-internal, no
  // Vercel body limit) to extract text, then insert the DB row.
  let body: {
    source?:           DocumentSource | 'upload_complete'
    category?:         string
    language?:         string
    subcategory?:      string | null
    drive_url?:        string | null
    filename?:         string
    notes?:            string | null
    effective_date?:   string | null
    expiry_date?:      string | null
    // upload_complete only:
    storage_path?:     string
    mime_type?:        string
    file_size_bytes?:  number
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  // ── upload_complete branch — metadata for a file already in storage
  if (body.source === 'upload_complete') {
    const storagePath = (body.storage_path ?? '').trim()
    const filename    = (body.filename ?? '').trim()
    if (!storagePath || !filename) {
      return NextResponse.json({ error: 'storage_path and filename are required for upload_complete' }, { status: 400 })
    }
    // Defense in depth: the upload-url endpoint generates paths under
    // <CODE>/<category>/... — reject anything that doesn't fit so a
    // tampered client can't write metadata pointing at another assoc's
    // file or an arbitrary path.
    if (!storagePath.startsWith(`${upperCode}/`)) {
      return NextResponse.json({ error: 'storage_path does not belong to this association' }, { status: 400 })
    }

    const category = normalizeCategory(body.category)
    const language = normalizeLanguage(body.language)

    // Signed-URL uploads land in storage RAW (the browser uploads directly,
    // bypassing the inline normalizeUpload on the multipart path). Compress
    // the stored object in place before we extract text + record it. HEIC
    // photos are transcoded to JPEG and the object is renamed to .jpg — pick
    // up the (possibly new) path / filename / mime for everything downstream.
    const norm = await normalizeStoredFile({ bucket: STORAGE_BUCKET, path: storagePath, contentType: body.mime_type ?? null, filename })
    if (norm.changed) console.log(`[assoc-docs] normalized ${storagePath}: ${norm.note}`)
    const effPath = norm.path
    const effName = norm.filename ?? filename
    const mime    = norm.contentType ?? body.mime_type ?? null

    // Fetch the file from storage to extract text. This bypasses
    // Vercel's body-size limit on the public-facing request because
    // it's an internal Supabase-to-server stream. For PDFs we extract
    // inline; non-PDFs get extraction_status='unsupported'.
    let extraction: { status: 'done' | 'skipped' | 'failed' | 'unsupported'; text: string | null; pages: number | null; error: string | null } =
      { status: 'unsupported', text: null, pages: null, error: null }
    if (isExtractableMime(mime, effName)) {
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(effPath)
      if (dlErr || !blob) {
        // Don't fail the row insert — staff can re-trigger extraction
        // later. Mark as failed so the UI shows the issue.
        extraction = { status: 'failed', text: null, pages: null, error: `Download for extraction failed: ${dlErr?.message ?? 'no blob'}` }
      } else {
        const buf = Buffer.from(await blob.arrayBuffer())
        extraction = await extractPdfText(buf, mime ?? 'application/pdf')
      }
    }

    const { data: inserted, error: dbErr } = await supabaseAdmin
      .from('association_documents')
      .insert({
        association_code:  upperCode,
        category,
        language,
        subcategory:       body.subcategory?.trim() || null,
        source:            'upload',
        storage_path:      effPath,
        drive_url:         null,
        filename:          effName,
        mime_type:         mime,
        file_size_bytes:   body.file_size_bytes ?? null,
        extracted_text:    extraction.text,
        extraction_status: extraction.status,
        extraction_error:  extraction.error,
        effective_date:    body.effective_date || null,
        expiry_date:       body.expiry_date || null,
        notes:             body.notes?.trim() || null,
        uploaded_by_email: actorEmail(session),
      })
      .select('*')
      .single()

    if (dbErr) {
      // Roll back the storage object so we don't leak an orphan file.
      await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([effPath]).catch(() => {})
      return NextResponse.json({ error: `DB insert failed: ${dbErr.message}` }, { status: 500 })
    }

    if (inserted?.id && category) {
      await archivePriorActiveVersions(upperCode, category, language, inserted.id, actorEmail(session))
    }
    return NextResponse.json({
      ok:       true,
      document: { ...inserted, extracted_text: null },
      pages:    extraction.pages,
    })
  }

  const source = body.source === 'note' ? 'note' : 'drive_link'

  if (source === 'drive_link') {
    if (!body.drive_url?.trim()) {
      return NextResponse.json({ error: 'drive_url is required' }, { status: 400 })
    }
  }

  const linkCategory = normalizeCategory(body.category)
  const linkLanguage = normalizeLanguage(body.language)
  const { data: inserted, error } = await supabaseAdmin
    .from('association_documents')
    .insert({
      association_code:  upperCode,
      category:          linkCategory,
      language:          linkLanguage,
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

  // Same auto-archive behavior on the JSON path (drive link / note).
  if (inserted?.id && inserted?.category) {
    await archivePriorActiveVersions(upperCode, inserted.category, linkLanguage, inserted.id, actorEmail(session))
  }
  return NextResponse.json({ ok: true, document: { ...inserted, extracted_text: null } })
}
