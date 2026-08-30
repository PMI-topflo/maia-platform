// POST /api/pre-apply/[token]/record-doc
//   { doc_key, doc_label, storage_path, filename, mime_type }
// Records an uploaded intake document against its checklist item. Token auth.

import { NextResponse } from 'next/server'
import { getIntake, resolveToken, recordIntakeDoc } from '@/lib/preapply'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { mirrorIntakeToDrive } from '@/lib/drive-application-mirror'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const esc = (s: string) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(r.applicationId)
  if (!intake) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (intake.submittedAt) return NextResponse.json({ error: 'This application has already been submitted.' }, { status: 400 })
  if (!r.stakeholder.emailVerifiedAt) return NextResponse.json({ error: 'Please verify your email before uploading.' }, { status: 403 })

  let b: { doc_key?: string; doc_label?: string; storage_path?: string; filename?: string; mime_type?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim()
  const path = String(b.storage_path ?? '').trim()
  if (!docKey || !path) return NextResponse.json({ error: 'doc_key and storage_path required' }, { status: 400 })
  if (!path.startsWith(`intake/${r.applicationId}/`)) return NextResponse.json({ error: 'path mismatch' }, { status: 400 })

  // Real incident, MANXI 802, 2026-08-29: an applicant uploaded an unrelated
  // person's background-check screenshot into `background_credit` — a
  // provided_by='staff' item, pulled by staff themselves from a verified
  // third-party source (Tenant Evaluation/Checkr), never something any
  // self-serve party should be able to write. The GET route already stops
  // showing these items, but this is the actual enforcement point — a stale
  // page or a direct call must not bypass it.
  const { data: docCfg } = await supabaseAdmin.from('association_intake_documents')
    .select('provided_by').eq('association_code', intake.associationCode).eq('application_type', intake.type).eq('doc_key', docKey).maybeSingle()
  if (docCfg?.provided_by === 'staff') {
    return NextResponse.json({ error: 'This document is provided by staff, not uploaded here.' }, { status: 403 })
  }
  // Rules Knowledge Acknowledgment is only ever captured by the dedicated
  // sign block on this same page (POST .../submit) — never a raw upload.
  if (docKey === 'governing_docs_ack') {
    return NextResponse.json({ error: 'Sign the rules acknowledgment below instead of uploading a file.' }, { status: 403 })
  }

  const res = await recordIntakeDoc(r.applicationId, r.stakeholder.id, {
    doc_key: docKey, doc_label: String(b.doc_label ?? docKey), storage_path: path,
    filename: String(b.filename ?? 'upload'), mime_type: b.mime_type ?? null,
    uploaded_by_role: r.stakeholder.role,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })

  // Documents used to reach Drive — and staff — only when the applicant pressed
  // SUBMIT at the end. Anyone who uploaded and stopped left their files sitting
  // invisibly in a "started" application with no Drive folder and no one told
  // (MANXI 1002: three documents in, nobody notified). So now every upload
  // mirrors to the unit's On Going folder immediately, and the FIRST document on
  // an application pings staff. Both best-effort — never fail the upload.
  void mirrorIntakeToDrive(r.applicationId).catch(() => null)

  const { count } = await supabaseAdmin.from('application_documents')
    .select('id', { count: 'exact', head: true }).eq('application_id', r.applicationId)
  if (count === 1 && NOTIFY.length) {
    const { data: app } = await supabaseAdmin.from('listing_applications')
      .select('association_code, unit_label, application_type').eq('id', r.applicationId).maybeSingle()
    void sendEmail({
      to: NOTIFY,
      subject: `📥 Documents arriving — ${app?.association_code ?? ''} Unit ${app?.unit_label ?? '—'} (application in progress)`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">
        <p><strong>${esc(r.stakeholder.name ?? r.stakeholder.role)}</strong> started uploading documents for
        <strong>${esc(String(app?.association_code ?? ''))}, Unit ${esc(String(app?.unit_label ?? '—'))}</strong>
        (${esc(String(app?.application_type ?? 'application'))}).</p>
        <p>The application is <strong>still in progress</strong> — they haven't submitted yet, so it sits under
        “Collecting documents”. You'll get the full submission notice when they finish.</p>
        <p><a href="${APP}/admin/pre-apply/${r.applicationId}">Open the application →</a></p>
      </div>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true })
}
