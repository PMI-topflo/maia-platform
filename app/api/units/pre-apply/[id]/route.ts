// GET   /api/units/pre-apply/[id]?assoc=CODE  → one application for board/manager review.
// PATCH /api/units/pre-apply/[id]  { assoc, action: 'approve' | 'decline' | 'request', note? }
//   The on-site manager / board approval decision (the dual-approval stage).
//   Scoped to the caller's association; approver role is derived from the persona.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { getIntakeChecklist, isApplicationType, signTemplateUrls, type ApplicationType } from '@/lib/intake-documents'
import { INTAKE_BUCKET, roleLabel, roleSigns } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function loadApp(id: string, assoc: string) {
  const { data } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, application_type, unit_label, status, submitted_at, rules_ack, drive_folder_url, audited_at, reviewed_at, review_note, approved_by_role')
    .eq('id', id).maybeSingle()
  if (!data || String(data.association_code).toUpperCase() !== assoc.toUpperCase()) return null
  // The board queue's list (GET /api/units/pre-apply) already only shows
  // applications with submitted_at set — but this detail/action endpoint had
  // no matching guard, so a reviewer with a bookmarked or guessed id could
  // still open, and even approve/decline, an application the applicant
  // hasn't finished submitting yet (docs/ROADMAP.md's Phasing item 7: "board
  // only ever sees complete applications"). submitted_at is set once, by
  // lib/preapply.ts's submitIntake(), only once every required document has
  // actually arrived -- same bar the list already applies.
  if (!data.submitted_at) return null
  return data
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveUnitsAuth(new URL(req.url).searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const app = await loadApp(id, auth.assoc)
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: sh }, { data: stakeholders }, { data: docs }, checklist] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('id, role, name, email, phone, is_primary, status, signed_at, rules_ack_name, email_verified_at, applicant_role, credit_score').eq('application_id', id).order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    supabaseAdmin.from('application_documents').select('doc_key, doc_label, storage_path, stakeholder_id').eq('application_id', id),
    isApplicationType(String(app.application_type)) ? getIntakeChecklist(auth.assoc, app.application_type as ApplicationType) : Promise.resolve([]),
  ])
  const documents = await Promise.all((docs ?? []).map(async d => {
    const { data: signed } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUrl(String(d.storage_path), 600)
    return { doc_key: d.doc_key as string | null, label: d.doc_label as string | null, url: signed?.signedUrl ?? null, stakeholderId: (d.stakeholder_id as string | null) ?? null }
  }))
  const exampleUrls = await signTemplateUrls(checklist)

  return NextResponse.json({
    id: app.id, type: app.application_type, unit: app.unit_label, status: app.status, submittedAt: app.submitted_at,
    applicant: sh ? { name: sh.name, email: sh.email, phone: sh.phone } : null,
    stakeholders: (stakeholders ?? []).map(s => ({
      id: s.id, role: s.role, roleLabel: roleLabel(String(s.role)), name: s.name, email: s.email,
      isPrimary: s.is_primary, status: s.status, signs: roleSigns(String(s.role)),
      signedAt: s.signed_at, rulesAckName: s.rules_ack_name, emailVerified: !!s.email_verified_at,
      applicantRole: (s.applicant_role as string | null) ?? null,
      creditScore: (s.credit_score as number | null) ?? null,
      phone: (s.phone as string | null) ?? null,
    })),
    rulesAck: app.rules_ack, driveFolderUrl: app.drive_folder_url,
    audited: !!app.audited_at, decided: !!app.reviewed_at, note: app.review_note, approvedByRole: app.approved_by_role,
    canApprove: auth.persona === 'board' || auth.persona === 'building_manager' || auth.persona === 'staff',
    canUpload: auth.canUpload,
    documents,
    checklist: checklist.map(c => ({ doc_key: c.doc_key, label: c.label, required: c.required, provided_by: c.provided_by, per_applicant: c.per_applicant, exampleUrl: c.template_path ? exampleUrls.get(c.template_path) ?? null : null })),
  })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let b: { assoc?: string; action?: string; note?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const auth = await resolveUnitsAuth(b.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (auth.persona !== 'board' && auth.persona !== 'building_manager' && auth.persona !== 'staff') {
    return NextResponse.json({ error: 'Not permitted to approve.' }, { status: 403 })
  }
  const { id } = await ctx.params
  const app = await loadApp(id, auth.assoc)
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  const who = auth.persona === 'board' ? 'board' : auth.persona === 'building_manager' ? 'onsite manager' : `staff`
  const role = auth.persona === 'board' ? 'board' : auth.persona === 'building_manager' ? 'onsite_manager' : 'staff'
  const patch: Record<string, unknown> = { updated_at: now }
  switch (b.action) {
    case 'approve': patch.status = 'approved'; patch.reviewed_by = who; patch.reviewed_at = now; patch.approved_by_role = role; patch.review_note = b.note?.trim() || null; break
    case 'decline': patch.status = 'declined'; patch.reviewed_by = who; patch.reviewed_at = now; patch.review_note = b.note?.trim() || null; break
    case 'request': patch.status = 'submitted'; patch.review_note = b.note?.trim() || null; break
    default: return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  }
  if ((b.action === 'decline' || b.action === 'request') && !patch.review_note) return NextResponse.json({ error: 'Add a note.' }, { status: 400 })

  const { error } = await supabaseAdmin.from('listing_applications').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: patch.status })
}
