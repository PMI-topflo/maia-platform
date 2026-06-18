// =====================================================================
// lib/document-intake-ingest.ts
// Shared MAIA Document Inbox ingest: take a file already staged in the
// association-documents bucket, classify it (multi-policy aware), split a
// bundled packet into per-policy files, resolve the owner/unit, and create
// the review rows. Used by both the browser upload POST and the Google Drive
// bulk importer.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeUpload } from '@/lib/pdf-normalize'
import { withExtension } from '@/lib/normalize-stored-file'
import { classifyDocument, type AssociationRef } from '@/lib/document-classifier'
import { resolveOwnerForDocument } from '@/lib/owner-match'
import { pdfPageCount, splitPdfRange } from '@/lib/pdf-split'

const BUCKET = 'association-documents'
export const INTAKE_SELECT = 'id, storage_path, filename, mime_type, status, suggested_association_code, suggested_category, suggested_item_key, suggested_scope, suggested_unit_ref, suggested_unit_label, doc_type, effective_date, expiration_date, source_storage_path, page_start, page_end, confidence, summary, model, created_at'

let _assocCache: { rows: AssociationRef[]; expiresAt: number } | null = null
async function associationRefs(): Promise<AssociationRef[]> {
  if (_assocCache && _assocCache.expiresAt > Date.now()) return _assocCache.rows
  const { data } = await supabaseAdmin.from('associations')
    .select('association_code, association_name, principal_address, city, state, zip, match_aliases').order('association_name')
  const rows: AssociationRef[] = (data ?? []).map(a => ({
    code: String(a.association_code), name: String(a.association_name ?? a.association_code),
    address: (a.principal_address as string | null) ?? null, city: (a.city as string | null) ?? null,
    state: (a.state as string | null) ?? null, zip: (a.zip as string | null) ?? null,
    aliases: Array.isArray(a.match_aliases) ? (a.match_aliases as string[]) : [],
  }))
  _assocCache = { rows, expiresAt: Date.now() + 5 * 60_000 }
  return rows
}

export async function ingestStagedDocument(opts: {
  storagePath: string
  filename: string | null
  mimeType: string | null
  uploadedBy: string | null
  /** Folder path / source hint (e.g. Drive breadcrumb) to help classify ambiguous files. */
  contextHint?: string | null
}): Promise<{ ok: true; rows: unknown[]; split: boolean } | { ok: false; error: string; status: number }> {
  const { storagePath, filename, mimeType, uploadedBy, contextHint } = opts
  if (!storagePath.startsWith('_inbox/')) return { ok: false, error: 'storage_path must be an inbox staging path', status: 400 }

  const assocs = await associationRefs()

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(storagePath)
  if (dlErr || !blob) return { ok: false, error: `storage download failed: ${dlErr?.message ?? 'no blob'}`, status: 500 }
  const raw  = Buffer.from(await blob.arrayBuffer())
  const norm = await normalizeUpload(raw, { contentType: mimeType ?? null, filename: filename ?? null }).catch(() => null)
  const buf  = norm?.buffer ?? raw

  // HEIC → JPEG: persist the converted bytes back to the staging object,
  // renamed to .jpg, so the staged file (and everything that references it)
  // is a browser-renderable image rather than an undisplayable HEIC.
  let basePath = storagePath
  let baseFilename = filename
  let baseMime = mimeType ?? null
  if (norm?.ext && norm.contentType && norm.buffer !== raw) {
    const renamed = withExtension(storagePath, norm.ext)
    const up = await supabaseAdmin.storage.from(BUCKET).upload(renamed, buf, { contentType: norm.contentType, upsert: true })
    if (!up.error) {
      if (renamed !== storagePath) await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).catch(() => {})
      basePath = renamed
      baseMime = norm.contentType
      if (filename) baseFilename = withExtension(filename, norm.ext)
    }
  }
  const isPdfDoc = (baseMime ?? '').includes('pdf') || /\.pdf$/i.test(basePath)
  const pageCount = await pdfPageCount(buf)

  let cls
  try { cls = await classifyDocument(buf, mimeType ?? null, assocs, pageCount, contextHint ?? null) }
  catch (err) { return { ok: false, error: `classification failed: ${(err as Error).message}`, status: 502 } }

  const detected = cls.items.length > 0
    ? cls.items
    : [{ scope: 'association' as const, unit_seen: null, category: null, item_key: null, doc_type: null, effective_date: null, expiration_date: null, page_start: null, page_end: null, confidence: cls.confidence }]
  const multi = detected.length > 1

  const inserts: Record<string, unknown>[] = []
  for (let i = 0; i < detected.length; i++) {
    const it = detected[i]
    let path = basePath
    let rowMime = baseMime ?? 'application/pdf'

    if (isPdfDoc && multi && pageCount > 1 && it.page_start && it.page_end) {
      const part = await splitPdfRange(buf, it.page_start, it.page_end).catch(() => null)
      if (part) {
        const slug = (it.item_key ?? `part${i + 1}`).replace(/[^a-z0-9]+/gi, '_')
        const splitPath = `${basePath.replace(/\.pdf$/i, '')}__${slug}_p${it.page_start}-${it.page_end}.pdf`
        const up = await supabaseAdmin.storage.from(BUCKET).upload(splitPath, part, { contentType: 'application/pdf', upsert: true })
        if (!up.error) { path = splitPath; rowMime = 'application/pdf' }
      }
    }

    let unitRef: string | null = null
    let unitLabel: string | null = null
    let resolvedAssoc: string | null = null
    if (it.scope === 'unit') {
      const owner = await resolveOwnerForDocument(cls.association_code, it.unit_seen).catch(() => null)
      if (owner) { unitRef = owner.account_number; unitLabel = owner.label; resolvedAssoc = owner.association_code }
      else if (it.unit_seen) unitLabel = it.unit_seen
    }
    const assocForRow = resolvedAssoc ?? cls.association_code

    const partName = multi && it.doc_type ? `${baseFilename ?? 'document'} — ${it.doc_type}` : (baseFilename ?? null)
    inserts.push({
      storage_path: path, filename: partName, mime_type: rowMime, status: 'review',
      suggested_association_code: assocForRow, suggested_category: it.category, suggested_item_key: it.item_key,
      suggested_scope: it.scope, suggested_unit_ref: unitRef, suggested_unit_label: unitLabel,
      doc_type: it.doc_type, effective_date: it.effective_date, expiration_date: it.expiration_date,
      source_storage_path: basePath, page_start: it.page_start, page_end: it.page_end,
      confidence: it.confidence || cls.confidence, summary: cls.summary, model: cls.model, uploaded_by: uploadedBy,
    })
  }

  const { data: rows, error } = await supabaseAdmin.from('document_intake').insert(inserts).select(INTAKE_SELECT)
  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true, rows: rows ?? [], split: multi }
}
