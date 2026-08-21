// POST /api/request/[token]/upload   (multipart: doc_key, file)
// Public (token-gated): the owner/tenant uploads one requested document. It's
// filed against the application (per-applicant items go to the primary applicant)
// and mirrored to the unit's On Going Applications Drive folder. PMI + Jonathan
// are notified to scan → confirm. No login.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { mirrorFileToOngoing } from '@/lib/drive-application-mirror'
import { sendEmail } from '@/lib/gmail'
import { loadRequest } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await loadRequest(token)
  if (!r) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 404 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const file = form.get('file')
  const docKey = String(form.get('doc_key') ?? '').trim()
  // Explicit "+ Add another page" click (as opposed to the default "Replace" —
  // uploading a corrected file). Independent of the checklist item's own
  // allow_multiple config, which governs a DIFFERENT case (genuinely separate
  // files, e.g. two years of tax returns) — this is one document that arrived
  // as several page photos, real case: a tenant's own note on their request,
  // "I have more paper to upload", and another (MANXI 303) resorting to
  // emailing 9 separate page scans because the upload button only ever
  // replaced. Staff already have "Combine" on their screen to merge the
  // resulting pages into one PDF.
  const append = String(form.get('append') ?? '') === '1'
  const item = r.mine.find(i => i.doc_key === docKey)
  if (!item) return NextResponse.json({ error: 'That document is not part of this request.' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'Please upload a PDF or image.' }, { status: 400 })
  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'File is over 25 MB.' }, { status: 400 })

  const appId = String(r.req.application_id)
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, listing_id, unit_label').eq('id', appId).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  // Per-applicant items land on the primary applicant; owner/shared items are unscoped.
  let stakeholderId: string | null = null
  const { data: cfg } = await supabaseAdmin.from('association_intake_documents')
    .select('per_applicant, allow_multiple').eq('association_code', r.req.association_code).eq('doc_key', docKey).limit(1).maybeSingle()
  if (cfg?.per_applicant) {
    const { data: prim } = await supabaseAdmin.from('application_stakeholders').select('id').eq('application_id', appId).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
    stakeholderId = (prim?.id as string | null) ?? null
  }

  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
  const keySafe = docKey.replace(/[^\w-]+/g, '_')
  const path = `intake/${appId}/${keySafe}/${crypto.randomUUID()}_${safe}`
  const up = await supabaseAdmin.storage.from(INTAKE_BUCKET).upload(path, buf, { contentType: file.type || 'application/pdf', upsert: true })
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 })

  if (!cfg?.allow_multiple && !append) {
    const del = supabaseAdmin.from('application_documents').delete().eq('application_id', appId).eq('doc_key', docKey)
    await (stakeholderId ? del.eq('stakeholder_id', stakeholderId) : del.is('stakeholder_id', null))
  }
  const { error: insErr } = await supabaseAdmin.from('application_documents').insert({
    application_id: appId, listing_id: app.listing_id, kind: 'other', doc_key: docKey, doc_label: item.label,
    storage_path: path, filename: file.name, mime_type: file.type || 'application/pdf', uploaded_by_role: `request:${r.role}`, stakeholder_id: stakeholderId,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  void mirrorFileToOngoing({ unitLabel: String(app.unit_label ?? appId.slice(0, 8)), applicantName: null, label: item.label, filename: file.name, mime: file.type || 'application/pdf', buffer: buf, associationCode: r.req.association_code ? String(r.req.association_code) : null }).catch(() => null)

  if (NOTIFY.length) {
    void sendEmail({ to: NOTIFY, subject: `Requested document uploaded — ${r.req.association_code} Unit ${app.unit_label ?? '—'} · ${item.label}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">
        <p>The ${r.role} uploaded <strong>${item.label}</strong> for <strong>${r.req.association_code}, Unit ${app.unit_label ?? '—'}</strong> via the request link.</p>
        <p>Please scan, read, and confirm it into MAIA.</p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'}/admin/pre-apply/${appId}">Open the application →</a></p>
      </div>` }).catch(() => null)
  }

  return NextResponse.json({ ok: true })
}
