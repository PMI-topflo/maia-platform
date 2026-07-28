// POST /api/units/documents/submit
//   { account, item_key, scope?, storage_path, filename?, mime_type? }
// After the browser uploaded the file (via /upload-url), MAIA validates
// it (reads type + expiry via lib/document-validation) and files a
// PENDING unit_document_submissions row for staff/board approval.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { validateDocument } from '@/lib/document-validation'
import { normalizeUpload, isHeicBuffer } from '@/lib/pdf-normalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const BUCKET = 'association-documents'

// Map a compliance item key to a document-validation spec (expiry-aware
// for the ones that carry a date). Unknown keys fall back to 'generic'
// (validated for readability, no expiry check).
function specForItem(itemKey: string): string {
  if (itemKey === 'unit.ho6')       return 'insurance_ho6'
  if (itemKey === 'unit.rules_ack') return 'governing_rules'
  if (itemKey === 'unit.leasing')   return 'applicant_lease'
  return 'generic'
}

export async function POST(req: Request) {
  let body: { account?: string; item_key?: string; scope?: string; storage_path?: string; filename?: string; mime_type?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canUpload) return NextResponse.json({ error: 'no upload permission' }, { status: 403 })

  const account = String(body.account ?? '').trim()
  const itemKey = String(body.item_key ?? '').trim()
  const path    = String(body.storage_path ?? '').trim()
  const scope   = body.scope === 'tenant' ? 'tenant' : 'unit'
  if (!account || !itemKey || !path) return NextResponse.json({ error: 'account, item_key, storage_path required' }, { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!path.startsWith(`unit-submissions/${auth.assoc}/${account}/`)) return NextResponse.json({ error: 'path mismatch' }, { status: 400 })

  // Read the uploaded file back.
  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(path)
  if (dlErr || !blob) return NextResponse.json({ error: `could not read uploaded file: ${dlErr?.message ?? 'missing'}` }, { status: 400 })
  const rawBuf = Buffer.from(await blob.arrayBuffer())

  // Normalize BEFORE MAIA reads it — same as the owner/tenant intake path
  // (which normalizes via ingestStagedDocument). This shrinks oversized PDFs
  // (a born-digital text PDF is preserved; a giant scan is rasterized to a
  // readable size), converts iPhone HEIC photos to JPEG, and resizes large
  // images. Without it, a big PDF or a HEIC photo silently fails the vision
  // read → no expiry date captured. The normalized bytes replace the stored
  // file so the reviewer + the filed record point at the readable copy.
  const wasHeic = isHeicBuffer(rawBuf) || /heic|heif/.test((body.mime_type ?? '').toLowerCase()) || /\.(heic|heif)$/i.test(body.filename ?? '')
  const norm = await normalizeUpload(rawBuf, { contentType: body.mime_type ?? null, filename: body.filename ?? null }).catch(() => null)
  const buf = norm?.buffer ?? rawBuf
  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (body.mime_type ?? '').includes('pdf')
  const effContentType = isPdf ? 'application/pdf' : (wasHeic ? 'image/jpeg' : (body.mime_type ?? null))
  if (norm?.changed) {
    await supabaseAdmin.storage.from(BUCKET).update(path, buf, { contentType: effContentType ?? 'application/octet-stream', upsert: true }).then(() => null, () => null)
  }

  let ai: { verdict: string; identified_as: string | null; expiration_date: string | null; reason: string } | null = null
  try {
    const r = await validateDocument(buf, effContentType, specForItem(itemKey))
    ai = { verdict: r.verdict, identified_as: r.identified_as, expiration_date: r.expiration_date, reason: r.reason }
  } catch (err) {
    console.warn(`[units/submit] validateDocument failed: ${(err as Error).message}`)
  }

  const { data: row, error } = await supabaseAdmin.from('unit_document_submissions').insert({
    association_code:     auth.assoc,
    unit_ref:             account,
    item_key:             itemKey,
    scope,
    storage_key:          path,
    filename:             body.filename ?? null,
    submitted_by_persona: auth.persona,
    submitted_by_id:      auth.userId,
    submitted_by_name:    auth.name,
    ai_verdict:           ai?.verdict ?? null,
    ai_identified_as:     ai?.identified_as ?? null,
    ai_expiration_date:   ai?.expiration_date ?? null,
    ai_summary:           ai?.reason ?? null,
    status:               'pending',
  }).select('id, ai_verdict, ai_identified_as, ai_expiration_date, ai_summary, status').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, submission: row })
}
