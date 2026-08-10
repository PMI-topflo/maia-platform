// POST /api/admin/pre-apply/[id]/upload   (multipart: file, doc_key, doc_label)
// Staff upload a document they received (e.g. by email) directly into an
// in-process application — it's recorded against the application AND mirrored
// into the unit's "On Going Applications" Drive folder (NOT Official; Official
// only happens on board approval, via the approval-move engine). Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { mirrorFileToOngoing } from '@/lib/drive-application-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, unit_label, submitted_at').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const file = form.get('file')
  const docKey = String(form.get('doc_key') ?? '').trim()
  const docLabel = String(form.get('doc_label') ?? '').trim() || docKey || 'Document'
  const stakeholderId = String(form.get('stakeholder_id') ?? '').trim() || null
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (!docKey) return NextResponse.json({ error: 'doc_key required' }, { status: 400 })
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'file must be a PDF or image' }, { status: 400 })
  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'file over 25 MB' }, { status: 400 })

  // Store in the private application-docs bucket, keyed like the applicant path.
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
  const keySafe = docKey.replace(/[^\w-]+/g, '_')
  const path = `intake/${id}/${keySafe}/${crypto.randomUUID()}_${safe}`
  const up = await supabaseAdmin.storage.from(INTAKE_BUCKET).upload(path, buf, { contentType: file.type || 'application/pdf', upsert: true })
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 500 })

  // Replace any prior upload for this checklist item — scoped to the applicant
  // for per-person items (doc_key + stakeholder_id), so each column is separate.
  const del = supabaseAdmin.from('application_documents').delete().eq('application_id', id).eq('doc_key', docKey)
  await (stakeholderId ? del.eq('stakeholder_id', stakeholderId) : del.is('stakeholder_id', null))
  const { error: insErr } = await supabaseAdmin.from('application_documents').insert({
    application_id: id, listing_id: app.listing_id, kind: 'other', doc_key: docKey, doc_label: docLabel,
    storage_path: path, filename: file.name, mime_type: file.type || 'application/pdf', uploaded_by_role: 'staff',
    stakeholder_id: stakeholderId,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Mirror into the unit's On Going Applications Drive folder (best-effort).
  const { data: sh } = await supabaseAdmin.from('application_stakeholders')
    .select('name').eq('application_id', id).eq('is_primary', true).maybeSingle()
  const drive = await mirrorFileToOngoing({
    unitLabel: String(app.unit_label ?? id.slice(0, 8)), applicantName: (sh?.name as string | null) ?? null,
    label: docLabel, filename: file.name, mime: file.type || 'application/pdf', buffer: buf,
  })
  if (drive.ok && drive.folderUrl) {
    await supabaseAdmin.from('listing_applications').update({ drive_folder_id: drive.folderId, drive_folder_url: drive.folderUrl, updated_at: new Date().toISOString() }).eq('id', id)
  }

  return NextResponse.json({ ok: true, drive })
}
