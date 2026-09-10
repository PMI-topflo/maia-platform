// POST /api/pre-apply/[token]/record-doc
//   { doc_key, doc_label, storage_path, filename, mime_type }
// Records an uploaded intake document against its checklist item. Token auth.

import { NextResponse } from 'next/server'
import { getIntake, resolveToken, recordIntakeDoc } from '@/lib/preapply'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { mirrorIntakeToDrive } from '@/lib/drive-application-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


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
  // sign block on this same page (POST .../submit); the Emergency Contact
  // List, Military Service Member Disclosure, Pet Registration and
  // Maintenance Assessment Acknowledgment are real e-signed forms too
  // (lib/application-esign-forms.ts) with a real signing link now attached
  // by the GET route — none of the five are ever satisfied by a raw upload.
  const LIVE_ESIGN_KEYS = new Set(['governing_docs_ack', 'emergency_contact', 'military_service_disclosure', 'pet_registration', 'maintenance_assessment_ack'])
  if (LIVE_ESIGN_KEYS.has(docKey)) {
    return NextResponse.json({ error: 'This item requires an e-signature, not an upload — use the "Sign now" link.' }, { status: 403 })
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

  // The first-document "Documents arriving" staff email is gone too (user
  // direction, 2026-09-10: fewer emails) — the daily digest's "documents
  // arrived in the last 24 hours" section covers in-progress applications,
  // and the Applications list shows them under "Documents arriving".

  return NextResponse.json({ ok: true })
}
