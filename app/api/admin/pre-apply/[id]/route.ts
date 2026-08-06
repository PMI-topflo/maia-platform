// GET   /api/admin/pre-apply/[id]  → full application for the audit view.
// PATCH /api/admin/pre-apply/[id]  { action: 'audit' | 'approve' | 'decline' | 'request', by_role?, note? }
//   Advance the pipeline: submitted → under_review (audited) → approved | declined.
//   Staff-only. (Dual-approval-by-board and Checkr trigger land in slice 3b.)

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getIntakeChecklist, isApplicationType, type ApplicationType } from '@/lib/intake-documents'
import { roleLabel, roleSigns } from '@/lib/preapply'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HANDOFF_NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

// On approval, hand the completed + audited package to the association's screening
// provider. Hybrid rollout: MANXI = tenant_evaluation (email the package to staff
// to proceed on the current system); maia_checkr triggers MAIA's own Checkr order
// when a detailed application is linked (dormant until an association flips).
async function handoffOnApproval(applicationId: string, byRole: string): Promise<void> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, unit_label, drive_folder_url, detailed_application_id').eq('id', applicationId).maybeSingle()
  if (!app) return
  const [{ data: assoc }, { data: sh }] = await Promise.all([
    supabaseAdmin.from('associations').select('screening_provider, association_name').eq('association_code', String(app.association_code)).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', applicationId).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
  ])
  const provider = (assoc?.screening_provider as string | null) ?? 'tenant_evaluation'

  if (provider === 'maia_checkr') {
    // Trigger MAIA's Checkr pipeline only when a detailed application is linked.
    if (app.detailed_application_id && process.env.INTERNAL_API_SECRET) {
      await fetch(`${APP}/api/trigger-screening`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET },
        body: JSON.stringify({ applicationId: app.detailed_application_id }),
      }).catch(() => null)
    }
    return
  }

  // tenant_evaluation: email the audited package to staff to proceed on the
  // current screening system.
  if (HANDOFF_NOTIFY.length) {
    void sendEmail({
      to: HANDOFF_NOTIFY,
      subject: `Approved — proceed on Tenant Evaluation: ${app.association_code} ${app.unit_label ? `Unit ${app.unit_label}` : ''} (${app.application_type})`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
        <p><strong>${esc(sh?.name ?? 'Applicant')}</strong>'s ${esc(String(app.application_type))} application for <strong>${esc(String(app.association_code))}</strong>${app.unit_label ? ` Unit ${esc(String(app.unit_label))}` : ''} passed compliance audit and was <strong>approved (${esc(byRole)})</strong>.</p>
        <p>Applicant: ${esc(sh?.email ?? '')}${sh?.phone ? ` · ${esc(String(sh.phone))}` : ''}</p>
        ${app.drive_folder_url ? `<p>📁 <a href="${app.drive_folder_url}">Documents in Drive →</a></p>` : ''}
        <p>Next step: proceed with the background check on the current Tenant Evaluation system.</p>
        <p><a href="${APP}/admin/pre-apply/${applicationId}">Open the application →</a></p>
      </div>`,
    }).catch(() => null)
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, application_type, applicant_role, unit_label, status, submitted_at, rules_ack, drive_folder_url, audited_by, audited_at, reviewed_by, reviewed_at, review_note, approved_by_role')
    .eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: assocRow } = await supabaseAdmin.from('associations').select('screening_provider').eq('association_code', String(app.association_code)).maybeSingle()

  const [{ data: sh }, { data: stakeholders }, { data: docs }, checklist] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('id, role, name, email, phone, is_primary, status, signed_at, rules_ack_name, email_verified_at').eq('application_id', id).order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    supabaseAdmin.from('application_documents').select('id, doc_key, doc_label, storage_path, filename, mime_type, suggested_name, expiration_date, uploaded_by_role, created_at').eq('application_id', id).order('created_at', { ascending: true }),
    isApplicationType(String(app.application_type)) ? getIntakeChecklist(String(app.association_code), app.application_type as ApplicationType) : Promise.resolve([]),
  ])

  // View links go through /doc/[docId] (fresh signed URL each click — never expire).
  const withUrls = (docs ?? []).map(d => ({
    id: d.id, doc_key: d.doc_key, doc_label: d.doc_label, filename: d.filename, mime_type: d.mime_type,
    suggestedName: (d.suggested_name as string | null) ?? null, expirationDate: (d.expiration_date as string | null) ?? null,
    bySource: (d.uploaded_by_role as string | null) ?? null, url: `/api/admin/pre-apply/${id}/doc/${d.id}`,
  }))
  const uploaded = new Set((docs ?? []).map(d => d.doc_key).filter(Boolean))

  return NextResponse.json({
    id: app.id, associationCode: app.association_code, type: app.application_type, unit: app.unit_label,
    status: app.status, submittedAt: app.submitted_at,
    applicant: sh ? { name: sh.name, email: sh.email, phone: sh.phone } : null,
    stakeholders: (stakeholders ?? []).map(s => ({
      id: s.id, role: s.role, roleLabel: roleLabel(String(s.role)), name: s.name, email: s.email, phone: s.phone,
      isPrimary: s.is_primary, status: s.status, signs: roleSigns(String(s.role)),
      signedAt: s.signed_at, rulesAckName: s.rules_ack_name, emailVerified: !!s.email_verified_at,
    })),
    rulesAck: app.rules_ack,
    driveFolderUrl: app.drive_folder_url,
    screeningProvider: (assocRow?.screening_provider as string | null) ?? 'tenant_evaluation',
    audit: { auditedBy: app.audited_by, auditedAt: app.audited_at, reviewedBy: app.reviewed_by, reviewedAt: app.reviewed_at, note: app.review_note, approvedByRole: app.approved_by_role },
    checklist: checklist.map(c => ({ doc_key: c.doc_key, label: c.label, required: c.required, provided_by: c.provided_by, uploaded: uploaded.has(c.doc_key) })),
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

  if (b.action === 'approve') await handoffOnApproval(id, String(patch.approved_by_role ?? 'staff'))
  return NextResponse.json({ ok: true, status: patch.status })
}
