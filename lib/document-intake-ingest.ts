// =====================================================================
// lib/document-intake-ingest.ts
// Shared MAIA Document Inbox ingest: take a file already staged in the
// association-documents bucket, classify it (multi-item aware — one
// document can satisfy several compliance items at once), resolve the
// owner/unit, and create ONE review row per uploaded file. The file is
// never split apart; staff multi-tag the single row with every item MAIA
// (or they) identify and file it once per tag, all against the same
// undivided document. Used by the browser upload POST and the Google
// Drive bulk importer.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeUpload } from '@/lib/pdf-normalize'
import { withExtension } from '@/lib/normalize-stored-file'
import { classifyDocument, type AssociationRef } from '@/lib/document-classifier'
import { resolveOwnerForDocument } from '@/lib/owner-match'
import { pdfPageCount } from '@/lib/pdf-split'

const BUCKET = 'association-documents'
export const INTAKE_SELECT = 'id, storage_path, filename, mime_type, status, suggested_association_code, suggested_category, suggested_item_key, suggested_scope, suggested_unit_ref, suggested_unit_label, suggested_items, doc_type, effective_date, expiration_date, source_storage_path, confidence, summary, model, created_at'

export interface SuggestedItem {
  item_key: string | null; category: string | null; doc_type: string | null
  effective_date: string | null; expiration_date: string | null; confidence: number
}

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
  const pageCount = await pdfPageCount(buf)

  let cls
  try { cls = await classifyDocument(buf, mimeType ?? null, assocs, pageCount, contextHint ?? null) }
  catch (err) { return { ok: false, error: `classification failed: ${(err as Error).message}`, status: 502 } }

  // The document itself belongs to one owner/unit context (if any of its
  // tagged items are unit-scope) — resolve that once from the first
  // unit-scope item MAIA found, rather than per-item.
  const firstUnitItem = cls.items.find(it => it.scope === 'unit')
  let unitRef: string | null = null
  let unitLabel: string | null = null
  let resolvedAssoc: string | null = null
  if (firstUnitItem) {
    const owner = await resolveOwnerForDocument(cls.association_code, firstUnitItem.unit_seen).catch(() => null)
    if (owner) { unitRef = owner.account_number; unitLabel = owner.label; resolvedAssoc = owner.association_code }
    else if (firstUnitItem.unit_seen) unitLabel = firstUnitItem.unit_seen
  }
  const assocForRow = resolvedAssoc ?? cls.association_code
  const scope: 'association' | 'unit' = firstUnitItem ? 'unit' : (cls.items[0]?.scope ?? 'association')

  const suggestedItems: SuggestedItem[] = cls.items.map(it => ({
    item_key: it.item_key, category: it.category, doc_type: it.doc_type,
    effective_date: it.effective_date, expiration_date: it.expiration_date, confidence: it.confidence,
  }))
  const first = cls.items[0] ?? null

  const { data: rows, error } = await supabaseAdmin.from('document_intake').insert({
    storage_path: basePath, filename: baseFilename, mime_type: baseMime ?? 'application/pdf', status: 'review',
    suggested_association_code: assocForRow, suggested_category: first?.category ?? null, suggested_item_key: first?.item_key ?? null,
    suggested_scope: scope, suggested_unit_ref: unitRef, suggested_unit_label: unitLabel, suggested_items: suggestedItems,
    doc_type: first?.doc_type ?? null, effective_date: first?.effective_date ?? null, expiration_date: first?.expiration_date ?? null,
    source_storage_path: basePath, confidence: cls.confidence, summary: cls.summary, model: cls.model, uploaded_by: uploadedBy,
  }).select(INTAKE_SELECT)
  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true, rows: rows ?? [], split: false }
}
