// POST /api/admin/pre-apply/[id]/upload   { doc_key, doc_label, storage_path, filename, mime_type, stakeholder_id?, allow_multiple? }
// Finalizes a document the browser already PUT directly to Supabase Storage
// via a signed URL from /api/admin/pre-apply/[id]/upload-url — it's recorded
// against the application AND mirrored into the unit's "On Going Applications"
// Drive folder (NOT Official; Official only happens on board approval, via the
// approval-move engine). Staff-only.
//
// Used to receive the raw file as multipart form data directly on this route —
// Vercel's Node function body-size limit rejected large PDFs (a signed lease,
// a purchase agreement) before this handler ever ran, and the client's
// `await r.json()` then threw on Vercel's own plain-text rejection body
// ("Unexpected token 'R', "Request En"..."). Found live, 2026-08-19, MANXI
// 303's Purchase Agreement. The file is already in storage by the time this
// runs, so it's downloaded here (an outgoing fetch, no incoming-body limit)
// for the same scan + Drive-mirror steps as before.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET, autoRosterFromLease, backfillPrimaryContactFromLease, loopInOwnerForMissingContact } from '@/lib/preapply'
import { mirrorFileToOngoing } from '@/lib/drive-application-mirror'
import { quickDocScan } from '@/lib/quick-doc-classify'
import { suggestedIntakeName } from '@/lib/intake-naming'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, unit_label, submitted_at').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  let b: { doc_key?: string; doc_label?: string; storage_path?: string; filename?: string; mime_type?: string; stakeholder_id?: string; allow_multiple?: boolean }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim()
  const docLabel = String(b.doc_label ?? '').trim() || docKey || 'Document'
  const storagePath = String(b.storage_path ?? '').trim()
  const filename = String(b.filename ?? 'upload')
  const mimeType = String(b.mime_type ?? '') || 'application/pdf'
  const stakeholderId = String(b.stakeholder_id ?? '').trim() || null
  const allowMultiple = !!b.allow_multiple
  if (!docKey) return NextResponse.json({ error: 'doc_key required' }, { status: 400 })
  if (!storagePath || !storagePath.startsWith(`intake/${id}/`)) return NextResponse.json({ error: 'invalid storage_path' }, { status: 400 })

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: `Could not read the uploaded file: ${dlErr?.message ?? 'not found'}` }, { status: 500 })
  const buf = Buffer.from(await blob.arrayBuffer())

  // Replace any prior upload for this checklist item — scoped to the applicant
  // for per-person items. Multi-file items (e.g. 2 years of tax returns) APPEND.
  if (!allowMultiple) {
    const del = supabaseAdmin.from('application_documents').delete().eq('application_id', id).eq('doc_key', docKey)
    await (stakeholderId ? del.eq('stakeholder_id', stakeholderId) : del.is('stakeholder_id', null))
  }
  // Read the document so its expiration is captured on upload — the Drive scan
  // did this but a direct upload didn't, so anything uploaded by hand had no
  // expiry to track (and no YYYY_MM_Type filing name). Best-effort.
  const scan = await quickDocScan(buf, mimeType).catch(() => ({ label: 'other', expiration: null as string | null }))
  let personName: string | null = null
  if (stakeholderId) {
    const { data: shRow } = await supabaseAdmin.from('application_stakeholders').select('name').eq('id', stakeholderId).maybeSingle()
    personName = (shRow?.name as string | null) ?? null
  }
  const { error: insErr } = await supabaseAdmin.from('application_documents').insert({
    application_id: id, listing_id: app.listing_id, kind: 'other', doc_key: docKey, doc_label: docLabel,
    storage_path: storagePath, filename, mime_type: mimeType, uploaded_by_role: 'staff',
    stakeholder_id: stakeholderId,
    expiration_date: scan.expiration,
    suggested_name: suggestedIntakeName({ docKey, filename, personName }),
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Mirror into the unit's On Going Applications Drive folder (best-effort).
  const { data: sh } = await supabaseAdmin.from('application_stakeholders')
    .select('name').eq('application_id', id).eq('is_primary', true).maybeSingle()
  const drive = await mirrorFileToOngoing({
    unitLabel: String(app.unit_label ?? id.slice(0, 8)), applicantName: (sh?.name as string | null) ?? null,
    label: docLabel, filename, mime: mimeType, buffer: buf,
    associationCode: String(app.association_code),
  })
  if (drive.ok && drive.folderUrl) {
    await supabaseAdmin.from('listing_applications').update({ drive_folder_id: drive.folderId, drive_folder_url: drive.folderUrl, updated_at: new Date().toISOString() }).eq('id', id)
  }

  // A freshly-uploaded lease seeds the applicant roster (best-effort), and —
  // if the primary applicant was created with a name only, no contact info in
  // hand — fills their email/phone from the lease itself if it's printed
  // there. If that still comes up empty, loop in the unit's owner as a last
  // resort so the application doesn't sit unreachable.
  if (docKey === 'signed_lease' && !stakeholderId) {
    await autoRosterFromLease(id)
    const filled = await backfillPrimaryContactFromLease(id)
    if (!filled) {
      const { data: primary } = await supabaseAdmin.from('application_stakeholders')
        .select('email, phone').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
      if (primary && !primary.email && !primary.phone) await loopInOwnerForMissingContact(id)
    }
  }

  return NextResponse.json({ ok: true, drive })
}
