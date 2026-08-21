// =====================================================================
// lib/application-outstanding-summary.ts
//
// "What is still outstanding on this application" — extracted out of
// lib/application-standard-reply.ts so a second caller (the collective
// 3-day missing-docs reminder, which addresses every stakeholder at once
// rather than whoever just emailed) doesn't reimplement the review-state +
// declaration-gating logic a second time and drift out of sync with it.
//
// Unfiltered by recipient — draftStandardReply still does its own
// providedByOkForRole() filtering on top of these rows for its single
// addressee; a caller that wants everyone's view uses the rows as-is.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReviewState } from '@/lib/board-review'
import { isEsignItem } from '@/lib/application-esign-forms'
import { getIntakeChecklist, isApplicationType, parseDeclarations, pendingDeclarations } from '@/lib/intake-documents'

export interface OutstandingRow {
  docKey: string
  /** Already combined with the per-applicant name, e.g. "Government ID — Jane Doe". */
  label: string
  providedBy: string
  perApplicantName: string | null
  isEsignItem: boolean
  /** Non-null when this item can't be asked for yet because the applicant
   *  hasn't answered the vehicle/animal yes-no question it depends on. */
  gatedBy: 'vehicle' | 'animal' | null
  /** Why it was sent back, when the state is 'refused' — the actionable part
   *  of "still outstanding" for anyone who has to go DO something about it
   *  (e.g. an agent-provided item: the applicant can't fix it themselves,
   *  but knowing WHY tells them what to relay). */
  refusedReason: string | null
}

export interface OutstandingSummary {
  applicationId: string
  associationCode: string
  unitLabel: string | null
  applicationType: string
  /** Every outstanding (waiting or refused) row, every role, ungated by who's asking. */
  rows: OutstandingRow[]
  /** The vehicle/animal questions themselves, deduped — asked once even
   *  though several doc_keys can share the same gate. */
  declineQuestions: ('vehicle' | 'animal')[]
  /** True when there is nothing left to ask for AND no pending declaration
   *  question — i.e. this application needs nothing further from anyone. */
  nothingOutstanding: boolean
}

export async function getOutstandingSummary(applicationId: string): Promise<OutstandingSummary | { error: string }> {
  const [{ data: app }, state] = await Promise.all([
    supabaseAdmin.from('listing_applications').select('id, association_code, unit_label, application_type, declarations').eq('id', applicationId).maybeSingle(),
    getReviewState(applicationId),
  ])
  if (!app || !state) return { error: 'application not found' }
  const associationCode = String(app.association_code)
  const unitLabel = (app.unit_label as string | null) ?? null
  const applicationType = String(app.application_type ?? '')

  // Deliberately over ALL rows, not just required ones — an optional item the
  // sender claims is "already handled" and plainly isn't is exactly what a
  // reminder exists to catch (see application-standard-reply.ts's own note).
  const outstanding = state.rows.filter(r => r.state === 'waiting' || r.state === 'refused')

  const checklist = isApplicationType(applicationType) ? await getIntakeChecklist(associationCode, applicationType) : []
  const declarations = parseDeclarations(app.declarations)
  const pending = pendingDeclarations(checklist, declarations)
  const docKeyCondition = new Map(checklist.map(c => [c.doc_key, c.condition_key]))
  const gatedUnanswered = (docKey: string): 'vehicle' | 'animal' | null => {
    const ck = docKeyCondition.get(docKey)
    if (ck === 'vehicle' && pending.includes('vehicle')) return 'vehicle'
    if ((ck === 'pet' || ck === 'assistance_animal') && pending.includes('animal')) return 'animal'
    return null
  }

  const rows: OutstandingRow[] = outstanding.map(r => ({
    docKey: r.docKey, label: r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label,
    providedBy: r.providedBy, perApplicantName: r.perApplicantName ?? null,
    isEsignItem: isEsignItem(r.docKey), gatedBy: gatedUnanswered(r.docKey),
    refusedReason: r.state === 'refused' ? (r.decision?.reason ?? null) : null,
  }))
  const declineQuestions = [...new Set(rows.map(r => r.gatedBy).filter((x): x is 'vehicle' | 'animal' => !!x))]
  const nothingOutstanding = rows.every(r => !!r.gatedBy) && declineQuestions.length === 0

  return { applicationId, associationCode, unitLabel, applicationType, rows, declineQuestions, nothingOutstanding }
}
