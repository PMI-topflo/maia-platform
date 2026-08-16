// GET   /api/admin/pre-apply/[id]  → full application for the audit view.
// PATCH /api/admin/pre-apply/[id]  { action: 'audit' | 'approve' | 'decline' | 'request', by_role?, note? }
//   Advance the pipeline: submitted → under_review (audited) → approved | declined.
//   Staff-only. (Dual-approval-by-board and Checkr trigger land in slice 3b.)

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getIntakeChecklist, isApplicationType, parseDeclarations, declaredNaKeys, type ApplicationType } from '@/lib/intake-documents'
import {
  animalDocGuidance, declaredPetWhereProhibited, isAssistanceAnimal,
  ASSISTANCE_ANIMAL_DENIAL_GROUNDS, ASSISTANCE_ANIMAL_DECISION_DAYS,
} from '@/lib/animal-accommodation'
import { roleLabel, roleSigns } from '@/lib/preapply'
import { getReviewState } from '@/lib/board-review'
import { getCurrentLease } from '@/lib/occupant-sponsorship'
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
    .select('id, association_code, application_type, applicant_role, unit_label, status, submitted_at, rules_ack, drive_folder_url, na_items, declarations, audited_by, audited_at, reviewed_by, reviewed_at, review_note, approved_by_role')
    .eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const code = String(app.association_code), unit = (app.unit_label as string | null) ?? ''
  const [{ data: assocRow }, { data: ownerRows }, { data: tenantRow }] = await Promise.all([
    supabaseAdmin.from('associations').select('screening_provider, pets_allowed').eq('association_code', code).maybeSingle(),
    // NOT maybeSingle(): a co-owned unit has one row PER OWNER, and MANXI 103
    // (Andre + Marcia Danford) is exactly that. maybeSingle() returns PGRST116
    // "multiple rows returned" and yields null, so the owner's name and email
    // silently vanished from the header — and from the document-request form,
    // which seeds the owner recipient from the same field. Married co-owners
    // are the common case in a condo, so this hit far more than one unit.
    supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, unit_number, account_number, status').eq('association_code', code).or(`unit_number.eq.${unit},account_number.eq.${code}${unit}`).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('unit_tenant_contacts').select('tenant_email').eq('association_code', code).eq('unit_ref', unit).maybeSingle(),
  ])

  const [{ data: sh }, { data: stakeholders }, { data: docs }, checklist] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('name, email, phone').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('id, role, name, email, phone, is_primary, status, signed_at, rules_ack_name, email_verified_at, applicant_role, credit_score').eq('application_id', id).order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    supabaseAdmin.from('application_documents').select('id, doc_key, doc_label, storage_path, filename, mime_type, suggested_name, expiration_date, no_expiration, uploaded_by_role, stakeholder_id, created_at').eq('application_id', id).order('created_at', { ascending: true }),
    isApplicationType(String(app.application_type)) ? getIntakeChecklist(String(app.association_code), app.application_type as ApplicationType) : Promise.resolve([]),
  ])

  // View links go through /doc/[docId] (fresh signed URL each click — never expire).
  const withUrls = (docs ?? []).map(d => ({
    id: d.id, doc_key: d.doc_key, doc_label: d.doc_label, filename: d.filename, mime_type: d.mime_type,
    suggestedName: (d.suggested_name as string | null) ?? null, expirationDate: (d.expiration_date as string | null) ?? null,
    noExpiration: !!d.no_expiration, bySource: (d.uploaded_by_role as string | null) ?? null,
    stakeholderId: (d.stakeholder_id as string | null) ?? null, url: `/api/admin/pre-apply/${id}/doc/${d.id}`,
  }))
  const uploaded = new Set((docs ?? []).map(d => d.doc_key).filter(Boolean))

  // Every owner on the unit, not just the first: a co-owned unit shows both
  // names, and a document request goes to every owner address on file (deduped,
  // since co-owners frequently share one).
  const ownerNames = (ownerRows ?? [])
    .map(o => (o.entity_name as string | null)?.trim() || `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim())
    .filter(Boolean)
  const ownerEmails = [...new Set((ownerRows ?? [])
    .flatMap(o => ((o.emails as string | null) ?? '').split(','))
    .map(e => e.trim().toLowerCase())
    .filter(e => e.includes('@')))]

  // The applicant's own yes/no answers retire the items that don't apply to
  // them (no car → no vehicle registration). Those are folded into naItems as
  // BARE doc_keys, which every completeness gate already reads as "applies to
  // nobody" — so this needs no change anywhere downstream, and it survives a
  // later change to the roster. Staff can still see the declaration and
  // override any single row by hand.
  // The per-document review: which are approved, refused, or merely on file.
  // The staff rows and the board's page read the SAME record, so a green flag
  // means the same thing on both.
  const review = await getReviewState(id)
  // What is already true about this unit. Shown on an additional-occupant
  // application so the board sees the tenant of record and the lease it is
  // being added to, without a second copy of either.
  const currentLease = String(app.application_type) === 'additional_occupant'
    ? await getCurrentLease(code, unit || null)
    : null
  const petsAllowed = (assocRow?.pets_allowed as boolean | null) ?? null
  const declarations = parseDeclarations(app.declarations)
  const derivedNa = declaredNaKeys(checklist, declarations, { petsAllowed })
  const naItems = [...new Set([...(Array.isArray(app.na_items) ? (app.na_items as string[]) : []), ...derivedNa])]

  return NextResponse.json({
    id: app.id, associationCode: app.association_code, type: app.application_type, unit: app.unit_label,
    status: app.status, submittedAt: app.submitted_at,
    applicant: sh ? { name: sh.name, email: sh.email, phone: sh.phone } : null,
    ownerName: ownerNames.join(' & ') || null,
    ownerEmails: ownerEmails.join(', ') || null,
    tenantEmail: (tenantRow?.tenant_email as string | null) || (sh?.email as string | null) || null,
    stakeholders: (stakeholders ?? []).map(s => ({
      id: s.id, role: s.role, roleLabel: roleLabel(String(s.role)), name: s.name, email: s.email, phone: s.phone,
      isPrimary: s.is_primary, status: s.status, signs: roleSigns(String(s.role)),
      signedAt: s.signed_at, rulesAckName: s.rules_ack_name, emailVerified: !!s.email_verified_at,
      applicantRole: (s.applicant_role as string | null) ?? null,
      creditScore: (s.credit_score as number | null) ?? null,
    })),
    rulesAck: app.rules_ack,
    driveFolderUrl: app.drive_folder_url,
    screeningProvider: (assocRow?.screening_provider as string | null) ?? 'tenant_evaluation',
    audit: { auditedBy: app.audited_by, auditedAt: app.audited_at, reviewedBy: app.reviewed_by, reviewedAt: app.reviewed_at, note: app.review_note, approvedByRole: app.approved_by_role },
    naItems,
    currentLease,
    review: review ? {
      rows: review.rows.map(r => ({ scopeKey: r.scopeKey, docKey: r.docKey, state: r.state, decision: r.decision, perApplicantName: r.perApplicantName })),
      totals: review.totals, complete: review.complete,
      windowOpenedAt: review.windowOpenedAt, windowDays: review.windowDays, dueAt: review.dueAt,
    } : null,
    declarations,
    declaredNa: derivedNa,
    petsAllowed,
    petsProhibitedNotice: declaredPetWhereProhibited(declarations, petsAllowed),
    animalGuidance: declarations.animal?.has && declarations.animal.kind ? animalDocGuidance(declarations.animal.kind) : null,
    assistanceAnimalDenialGrounds: isAssistanceAnimal(declarations.animal?.kind) ? ASSISTANCE_ANIMAL_DENIAL_GROUNDS : [],
    assistanceAnimalDecisionDays: ASSISTANCE_ANIMAL_DECISION_DAYS,
    checklist: checklist.map(c => ({ doc_key: c.doc_key, label: c.label, required: c.required, provided_by: c.provided_by, per_applicant: c.per_applicant, allow_multiple: c.allow_multiple, uploaded: uploaded.has(c.doc_key), condition_key: c.condition_key, template_path: c.template_path })),
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
