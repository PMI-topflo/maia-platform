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
import { handoffOnApproval } from '@/lib/application-handoff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  // 'approve' runs the real thing (Drive filing/archiving + screening
  // handoff), not just a status flip — PR7 made runBoardApprove the single
  // path that reaches 'approved', so a manual trigger here (a genuine
  // fallback if the automatic esign-completion run needs a retry) must go
  // through the exact same function rather than a shortcut that would leave
  // the unit's Drive folder never filed while the DB says approved.
  if (b.action === 'approve') {
    const { runBoardApprove } = await import('@/lib/board-approve')
    const byRole = ['onsite_manager', 'board', 'staff'].includes(String(b.by_role)) ? (b.by_role as 'onsite_manager' | 'board' | 'staff') : 'staff'
    const outcome = await runBoardApprove(id, { approvedByRole: byRole })
    if ('error' in outcome) return NextResponse.json({ error: outcome.error }, { status: 400 })
    await handoffOnApproval(id, byRole)
    return NextResponse.json({ ok: true, status: 'approved' })
  }

  const patch: Record<string, unknown> = { updated_at: now }
  switch (b.action) {
    case 'audit':   patch.audited_by = who; patch.audited_at = now; patch.status = 'under_review'; break
    case 'decline': patch.status = 'declined';  patch.reviewed_by = who; patch.reviewed_at = now; patch.review_note = b.note?.trim() || null; break
    case 'request': patch.status = 'submitted'; if (b.note?.trim()) patch.review_note = b.note.trim(); break
    default: return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('listing_applications').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, status: patch.status })
}

// DELETE /api/admin/pre-apply/[id]
// Removes a bare-shell application — one with nothing in it. User direction,
// 2026-08-19: several units got imported via "Bring into MAIA" with an empty
// Drive folder behind them and never went anywhere (MANXI 605: created by
// staff, zero documents, zero stakeholders, zero communications, six hours
// later still empty). There was no way to remove one short of a direct
// database delete — this is that button, with the safety built into the
// endpoint itself rather than trusted to the UI: it independently re-checks
// every table an application can hold data in and refuses if ANY of them are
// non-empty, the same checklist docs/APPLICATIONS-EMAIL-PLAYBOOK.md already
// documents for judging a duplicate application "a bare shell." A stakeholder
// who signed or verified email also blocks deletion even if this endpoint's
// own check missed something, because listing_applications.status alone is
// never trusted here — the actual child rows are.
//
// Best-effort trashes (not permanently deletes) the linked Drive folder too,
// so one click clears both sides — never blocks the MAIA-side delete on a
// Drive failure, since prod-only Drive creds don't exist in every environment
// this could run in.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, listing_id, drive_folder_id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  const [docs, stakeholders, comms, reqs, reviews] = await Promise.all([
    supabaseAdmin.from('application_documents').select('id', { count: 'exact', head: true }).eq('application_id', id),
    supabaseAdmin.from('application_stakeholders').select('id', { count: 'exact', head: true }).eq('application_id', id),
    supabaseAdmin.from('application_communications').select('id', { count: 'exact', head: true }).eq('application_id', id),
    supabaseAdmin.from('document_requests').select('id', { count: 'exact', head: true }).eq('application_id', id),
    supabaseAdmin.from('application_document_reviews').select('id', { count: 'exact', head: true }).eq('application_id', id),
  ])
  const counts = { documents: docs.count ?? 0, stakeholders: stakeholders.count ?? 0, communications: comms.count ?? 0, requests: reqs.count ?? 0, reviews: reviews.count ?? 0 }
  const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0)
  if (nonEmpty.length) {
    return NextResponse.json({ error: `Not empty — has ${nonEmpty.map(([k, n]) => `${n} ${k}`).join(', ')}. Only a bare-shell application can be deleted this way.` }, { status: 409 })
  }

  let driveTrashed = false, driveError: string | null = null
  if (app.drive_folder_id) {
    try {
      const { getDrive } = await import('@/lib/drive-invoice-mirror')
      await getDrive().files.update({ fileId: String(app.drive_folder_id), requestBody: { trashed: true }, supportsAllDrives: true })
      driveTrashed = true
    } catch (err) { driveError = err instanceof Error ? err.message : String(err) }
  }

  const { error: delAppErr } = await supabaseAdmin.from('listing_applications').delete().eq('id', id)
  if (delAppErr) return NextResponse.json({ error: delAppErr.message }, { status: 500 })
  if (app.listing_id) await supabaseAdmin.from('unit_listings').delete().eq('id', app.listing_id)

  return NextResponse.json({ ok: true, driveTrashed, driveError })
}
