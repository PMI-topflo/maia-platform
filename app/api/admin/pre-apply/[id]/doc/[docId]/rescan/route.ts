// POST /api/admin/pre-apply/[id]/doc/[docId]/rescan
// Re-read a document that is ALREADY stored, and fill in its expiration date
// (and filing name, if blank) from what MAIA reads on the page.
//
// Why this exists: every ingest path scans on save, but best-effort — a failed
// Haiku call must never lose the file, so `quickDocScan` is wrapped in a catch
// that returns an empty result. That is the right trade-off, but it means a
// scan failure produces a document with no expiration and NO WAY TO RECOVER it
// short of deleting and re-uploading. It also left every document uploaded
// before the scan-on-upload fix with a blank expiration. The file itself is in
// storage the whole time — nobody needs to send it again, we just never read it.
//
// Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { quickDocScanDetailed } from '@/lib/quick-doc-classify'
import { suggestedIntakeName } from '@/lib/intake-naming'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, docId } = await ctx.params

  const { data: doc } = await supabaseAdmin.from('application_documents')
    .select('id, doc_key, storage_path, filename, mime_type, expiration_date, suggested_name, no_expiration, stakeholder_id, created_at')
    .eq('id', docId).eq('application_id', id).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'document not found' }, { status: 404 })
  if (!doc.storage_path) return NextResponse.json({ error: 'this document has no stored file to read' }, { status: 400 })
  // Staff ticking "does not expire" is a decision about the document, not a
  // gap to fill — don't undo it behind their back.
  if (doc.no_expiration) return NextResponse.json({ error: 'this document is marked "does not expire" — untick that first' }, { status: 400 })

  const dl = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(doc.storage_path))
  if (dl.error || !dl.data) return NextResponse.json({ error: `could not read the stored file: ${dl.error?.message ?? 'missing'}` }, { status: 502 })
  const buf = Buffer.from(await dl.data.arrayBuffer())

  const scan = await quickDocScanDetailed(buf, (doc.mime_type as string | null) ?? 'application/pdf')
  if (!scan.ok) return NextResponse.json({ error: `MAIA could not read this document: ${scan.error ?? 'unknown error'}` }, { status: 502 })

  const patch: Record<string, unknown> = {}
  if (scan.expiration) patch.expiration_date = scan.expiration
  // Backfill the YYYY_MM_Type filing name only when it's missing — a name staff
  // typed by hand outranks a generated one. Stamp it from when the document was
  // uploaded, not from today, so a re-scan doesn't re-date an old file.
  if (!doc.suggested_name) {
    let personName: string | null = null
    if (doc.stakeholder_id) {
      const { data: sh } = await supabaseAdmin.from('application_stakeholders').select('name').eq('id', doc.stakeholder_id).maybeSingle()
      personName = (sh?.name as string | null) ?? null
    }
    patch.suggested_name = suggestedIntakeName({
      docKey: String(doc.doc_key ?? ''), filename: doc.filename as string | null,
      when: doc.created_at as string | null, personName,
    })
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabaseAdmin.from('application_documents').update(patch).eq('id', docId).eq('application_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    read: scan.label,
    expiration: scan.expiration,
    // The caller needs to distinguish "found a date" from "read it fine, this
    // document simply has no expiration printed on it".
    foundExpiration: !!scan.expiration,
    suggestedName: (patch.suggested_name as string | undefined) ?? (doc.suggested_name as string | null),
  })
}
