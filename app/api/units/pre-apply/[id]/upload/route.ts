// POST /api/units/pre-apply/[id]/upload   (multipart: assoc, file, doc_key, doc_label)
// The board / on-site manager uploads a document they received for an application
// (e.g. a missing file). It's recorded against the application, mirrored into the
// unit's "On Going Applications" Drive folder, and PMI + Jonathan are emailed so
// they can scan, read, and confirm it into MAIA. Units-portal auth + upload right.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { mirrorFileToOngoing } from '@/lib/drive-application-mirror'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(String(form.get('assoc') ?? '') || null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canUpload) return NextResponse.json({ error: 'no permission' }, { status: 403 })

  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id, association_code, unit_label').eq('id', id).maybeSingle()
  if (!app || String(app.association_code).toUpperCase() !== auth.assoc.toUpperCase()) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (auth.managedUnits && app.unit_label && !auth.managedUnits.includes(String(app.unit_label))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const file = form.get('file')
  const docKey = String(form.get('doc_key') ?? '').trim()
  const docLabel = String(form.get('doc_label') ?? '').trim() || docKey || 'Document'
  const stakeholderId = String(form.get('stakeholder_id') ?? '').trim() || null
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (!docKey) return NextResponse.json({ error: 'doc_key required' }, { status: 400 })
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'file must be a PDF or image' }, { status: 400 })
  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'file over 25 MB' }, { status: 400 })

  const persona = auth.persona === 'board' ? 'board' : auth.persona === 'building_manager' ? 'onsite_manager' : auth.persona
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
  const keySafe = docKey.replace(/[^\w-]+/g, '_')
  const path = `intake/${id}/${keySafe}/${crypto.randomUUID()}_${safe}`
  const up = await supabaseAdmin.storage.from(INTAKE_BUCKET).upload(path, buf, { contentType: file.type || 'application/pdf', upsert: true })
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 500 })

  // Latest upload wins — scoped to the applicant for per-person items.
  const del = supabaseAdmin.from('application_documents').delete().eq('application_id', id).eq('doc_key', docKey)
  await (stakeholderId ? del.eq('stakeholder_id', stakeholderId) : del.is('stakeholder_id', null))
  const { error: insErr } = await supabaseAdmin.from('application_documents').insert({
    application_id: id, listing_id: app.listing_id, kind: 'other', doc_key: docKey, doc_label: docLabel,
    storage_path: path, filename: file.name, mime_type: file.type || 'application/pdf', uploaded_by_role: `units:${persona}`,
    stakeholder_id: stakeholderId,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Mirror into the unit's On Going Applications Drive folder (best-effort).
  const { data: sh } = await supabaseAdmin.from('application_stakeholders')
    .select('name').eq('application_id', id).eq('is_primary', true).maybeSingle()
  void mirrorFileToOngoing({
    unitLabel: String(app.unit_label ?? id.slice(0, 8)), applicantName: (sh?.name as string | null) ?? null,
    label: docLabel, filename: file.name, mime: file.type || 'application/pdf', buffer: buf,
    associationCode: String(app.association_code),
  }).catch(() => null)

  // Tell PMI + Jonathan so they scan, read, and confirm it into MAIA.
  if (NOTIFY.length) {
    const whoLabel = auth.persona === 'board' ? 'A board member' : auth.persona === 'building_manager' ? 'The on-site manager' : 'Staff'
    void sendEmail({
      to: NOTIFY,
      subject: `Application document uploaded — ${auth.assoc} Unit ${app.unit_label ?? '—'} · ${docLabel}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f26a1b;font-weight:700;margin:0 0 4px">PMI Top Florida Properties</p>
        <h2 style="margin:0 0 8px;color:#1f2a44">A document was uploaded for review</h2>
        <p>${whoLabel} uploaded <strong>${docLabel}</strong> for <strong>${auth.assoc}, Unit ${app.unit_label ?? '—'}</strong> (${sh?.name ? String(sh.name) : 'applicant'}).</p>
        <p>Please scan, read, and confirm it into MAIA.</p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'}/admin/pre-apply/${id}" style="color:#2563eb;font-weight:600">Open the application →</a></p>
      </div>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true })
}
