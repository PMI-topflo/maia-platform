// GET   /api/admin/pre-apply/[id]  → full application for the audit view.
// PATCH /api/admin/pre-apply/[id]  { action: 'audit' | 'approve' | 'decline' | 'request', by_role?, note? }
//   Advance the pipeline: submitted → under_review (audited) → approved | declined.
//   Staff-only. (Dual-approval-by-board and Checkr trigger land in slice 3b.)

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getIntakeChecklist, isApplicationType, type ApplicationType } from '@/lib/intake-documents'
import { INTAKE_BUCKET } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, application_type, applicant_role, unit_label, status, submitted_at, rules_ack, drive_folder_url, audited_by, audited_at, reviewed_by, reviewed_at, review_note, approved_by_role')
    .eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: sh }, { data: docs }, checklist] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('application_documents').select('id, doc_key, doc_label, storage_path, filename, mime_type, created_at').eq('application_id', id).order('created_at', { ascending: true }),
    isApplicationType(String(app.application_type)) ? getIntakeChecklist(String(app.association_code), app.application_type as ApplicationType) : Promise.resolve([]),
  ])

  // Short-lived preview URLs for each uploaded doc.
  const withUrls = await Promise.all((docs ?? []).map(async d => {
    const { data: signed } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUrl(String(d.storage_path), 600)
    return { id: d.id, doc_key: d.doc_key, doc_label: d.doc_label, filename: d.filename, mime_type: d.mime_type, url: signed?.signedUrl ?? null }
  }))
  const uploaded = new Set((docs ?? []).map(d => d.doc_key).filter(Boolean))

  return NextResponse.json({
    id: app.id, associationCode: app.association_code, type: app.application_type, unit: app.unit_label,
    status: app.status, submittedAt: app.submitted_at,
    applicant: sh ? { name: sh.name, email: sh.email, phone: sh.phone } : null,
    rulesAck: app.rules_ack,
    driveFolderUrl: app.drive_folder_url,
    audit: { auditedBy: app.audited_by, auditedAt: app.audited_at, reviewedBy: app.reviewed_by, reviewedAt: app.reviewed_at, note: app.review_note, approvedByRole: app.approved_by_role },
    checklist: checklist.map(c => ({ label: c.label, required: c.required, provided_by: c.provided_by, uploaded: uploaded.has(c.doc_key) })),
    documents: withUrls,
  })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { action?: string; by_role?: string; note?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const now = new Date().toISOString()
  const who = `staff:${session.displayName}`
  const patch: Record<string, unknown> = { updated_at: now }

  switch (b.action) {
    case 'audit':   patch.audited_by = who; patch.audited_at = now; patch.status = 'under_review'; break
    case 'approve': patch.status = 'approved';  patch.reviewed_by = who; patch.reviewed_at = now; patch.approved_by_role = ['onsite_manager', 'board', 'staff'].includes(String(b.by_role)) ? b.by_role : 'staff'; patch.review_note = b.note?.trim() || null; break
    case 'decline': patch.status = 'declined';  patch.reviewed_by = who; patch.reviewed_at = now; patch.review_note = b.note?.trim() || null; break
    case 'request': patch.status = 'submitted'; patch.review_note = b.note?.trim() || null; break
    default: return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('listing_applications').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: patch.status })
}
