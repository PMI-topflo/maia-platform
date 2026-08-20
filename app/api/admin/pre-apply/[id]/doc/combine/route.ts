// POST /api/admin/pre-apply/[id]/doc/combine   { doc_key, stakeholder_id? }
//
// Merges every file currently filed under one multi-file checklist item
// (e.g. tax returns scanned as a dozen separate page images) into ONE
// combined PDF, in the order they were added. User direction, 2026-08-19:
// "I [have] multiple pages of the same file (tax return) how can I make
// Maia append all of them?"
//
// The individual files are only deleted AFTER the combined PDF is
// successfully saved — never the other way around, so a failure here loses
// nothing. Mirrors the combined file to Drive same as any other upload;
// the individual copies already mirrored earlier are left there (Drive
// cleanup is a separate, existing tool, not this route's job).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { combineToPdf } from '@/lib/pdf-normalize'
import { mirrorFileToOngoing } from '@/lib/drive-application-mirror'
import { suggestedIntakeName } from '@/lib/intake-naming'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { doc_key?: string; stakeholder_id?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim()
  const stakeholderId = String(b.stakeholder_id ?? '').trim() || null
  if (!docKey) return NextResponse.json({ error: 'doc_key required' }, { status: 400 })

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  let q = supabaseAdmin.from('application_documents')
    .select('id, doc_label, filename, storage_path, mime_type').eq('application_id', id).eq('doc_key', docKey).order('created_at', { ascending: true })
  q = stakeholderId ? q.eq('stakeholder_id', stakeholderId) : q.is('stakeholder_id', null)
  const { data: rows } = await q
  if (!rows || rows.length < 2) return NextResponse.json({ error: 'Need at least 2 files on this item to combine.' }, { status: 400 })

  const files = await Promise.all(rows.map(async r => {
    const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(r.storage_path))
    return blob ? { buffer: Buffer.from(await blob.arrayBuffer()), mimeType: (r.mime_type as string | null) ?? null } : null
  }))
  const ok = files.filter((f) => f !== null)
  if (ok.length < 2) return NextResponse.json({ error: 'Could not read enough of the files to combine.' }, { status: 500 })

  const combined = await combineToPdf(ok)
  const docLabel = String(rows[0].doc_label ?? docKey)
  const filename = `${docLabel.replace(/[\\/:*?"<>|]+/g, '_')}.pdf`

  let personName: string | null = null
  if (stakeholderId) {
    const { data: shRow } = await supabaseAdmin.from('application_stakeholders').select('name').eq('id', stakeholderId).maybeSingle()
    personName = (shRow?.name as string | null) ?? null
  }
  const keySafe = docKey.replace(/[^\w-]+/g, '_')
  const path = `intake/${id}/${keySafe}/${crypto.randomUUID()}_combined.pdf`
  const up = await supabaseAdmin.storage.from(INTAKE_BUCKET).upload(path, combined, { contentType: 'application/pdf', upsert: true })
  if (up.error) return NextResponse.json({ error: `Could not save the combined PDF: ${up.error.message}` }, { status: 500 })

  const { error: insErr } = await supabaseAdmin.from('application_documents').insert({
    application_id: id, listing_id: app.listing_id, kind: 'other', doc_key: docKey, doc_label: docLabel,
    storage_path: path, filename, mime_type: 'application/pdf', uploaded_by_role: 'staff',
    stakeholder_id: stakeholderId,
    suggested_name: suggestedIntakeName({ docKey, filename, personName }),
  })
  if (insErr) return NextResponse.json({ error: `Combined but could not save the record: ${insErr.message}` }, { status: 500 })

  // Only delete the individual pages AFTER the combined row is safely in.
  await supabaseAdmin.from('application_documents').delete().in('id', rows.map(r => String(r.id)))

  const drive = await mirrorFileToOngoing({
    unitLabel: String(app.unit_label ?? id.slice(0, 8)), applicantName: personName,
    label: docLabel, filename, mime: 'application/pdf', buffer: combined,
    associationCode: String(app.association_code),
  })
  if (drive.ok && drive.folderUrl) {
    await supabaseAdmin.from('listing_applications').update({ drive_folder_id: drive.folderId, drive_folder_url: drive.folderUrl, updated_at: new Date().toISOString() }).eq('id', id)
  }

  return NextResponse.json({ ok: true, combined: rows.length, drive })
}
