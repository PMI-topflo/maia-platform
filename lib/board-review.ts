// =====================================================================
// lib/board-review.ts
//
// The per-document board review, and the 30-day decision window.
//
// THE RULE (standard for every association): the Board may decide up to
// 30 DAYS AFTER THE LAST REQUESTED DOCUMENT IS RECEIVED.
//
// Two consequences fall out of that sentence, and both live here so the
// staff screen, the reviewer page, the emails and the reminder cron cannot
// disagree about them:
//
//   1. A document that has NOT ARRIVED cannot be reviewed. There is nothing
//      to open. It is not "pending a decision", it is pending an upload, and
//      the two must not look alike.
//   2. The window opens only when EVERY required document has arrived and
//      been decided. Until then there is no deadline, because the clock the
//      rule describes has not started.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getIntakeChecklist, isApplicationType, parseDeclarations, declaredNaKeys, type IntakeDoc } from '@/lib/intake-documents'

export type ReviewDecision = 'approved' | 'refused'
export type ReviewerRole = 'board' | 'onsite_manager' | 'staff'

export const REVIEWER_ROLE_LABEL: Record<ReviewerRole, string> = {
  board: 'Board',
  onsite_manager: 'On-site manager',
  staff: 'PMI staff',
}

/** The four states a document can be in, in the order they happen. The names
 *  are the ones used in the UI — "waiting" is waiting on an UPLOAD, never on
 *  a decision, which is the distinction the old single "saved" state lost. */
export type DocState = 'waiting' | 'received' | 'approved' | 'refused'

export interface ReviewRow {
  docKey: string
  scopeKey: string              // docKey, or docKey#stakeholderId for per-applicant items
  label: string
  providedBy: string
  required: boolean
  perApplicantName: string | null
  state: DocState
  documentId: string | null
  filename: string | null
  decision: { by: string; role: ReviewerRole; at: string; reason: string | null } | null
}

export interface ReviewState {
  rows: ReviewRow[]
  /** Required rows only — the optional ones never hold the window open. */
  totals: { required: number; received: number; decided: number; approved: number; refused: number; waiting: number }
  /** Every required document received AND decided, none refused. */
  complete: boolean
  windowOpenedAt: string | null
  windowDays: number
  dueAt: string | null
}

const scoped = (docKey: string, sid: string | null) => sid ? `${docKey}#${sid}` : docKey

/** Read the whole review state for an application. One query set, one truth. */
export async function getReviewState(applicationId: string): Promise<ReviewState | null> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, na_items, declarations, board_window_opened_at, board_window_days')
    .eq('id', applicationId).maybeSingle()
  if (!app) return null

  const type = String(app.application_type ?? '')
  const code = String(app.association_code ?? '')
  const [checklist, { data: docs }, { data: reviews }, { data: people }, { data: assoc }] = await Promise.all([
    isApplicationType(type) ? getIntakeChecklist(code, type) : Promise.resolve([] as IntakeDoc[]),
    supabaseAdmin.from('application_documents').select('id, doc_key, filename, stakeholder_id').eq('application_id', applicationId),
    supabaseAdmin.from('application_document_reviews').select('scope_key, decision, reason, decided_by, decided_by_role, decided_at').eq('application_id', applicationId),
    supabaseAdmin.from('application_stakeholders').select('id, name, applicant_role').eq('application_id', applicationId).eq('role', 'applicant').order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    supabaseAdmin.from('associations').select('pets_allowed').eq('association_code', code).maybeSingle(),
  ])

  // Items the applicant's own declaration retired ("I keep no vehicle") are not
  // outstanding — they do not apply, so they must never hold the window shut.
  const declarations = parseDeclarations(app.declarations)
  const na = new Set([
    ...(Array.isArray(app.na_items) ? (app.na_items as string[]) : []),
    ...declaredNaKeys(checklist, declarations, { petsAllowed: (assoc?.pets_allowed as boolean | null) ?? null }),
  ])
  const isNa = (docKey: string, sid: string | null) => na.has(docKey) || (!!sid && na.has(`${docKey}#${sid}`))

  const byScope = new Map((reviews ?? []).map(r => [String(r.scope_key), r]))
  // Minors don't hold up a review — they provide nothing.
  const applicants = (people ?? []).filter(p => String(p.applicant_role ?? '') !== 'minor_dependent')

  const rows: ReviewRow[] = []
  for (const c of checklist) {
    const targets: { sid: string | null; name: string | null }[] = c.per_applicant && applicants.length
      ? applicants.map(a => ({ sid: String(a.id), name: (a.name as string | null) ?? null }))
      : [{ sid: null, name: null }]

    for (const t of targets) {
      if (isNa(c.doc_key, t.sid)) continue
      const scopeKey = scoped(c.doc_key, t.sid)
      // A SHARED item is satisfied by whoever uploaded it; a per-applicant item
      // is strictly that person's.
      const doc = t.sid
        ? (docs ?? []).find(d => d.doc_key === c.doc_key && String(d.stakeholder_id ?? '') === t.sid)
        : (docs ?? []).find(d => d.doc_key === c.doc_key)
      const rev = byScope.get(scopeKey)
      const state: DocState = !doc ? 'waiting'
        : rev?.decision === 'approved' ? 'approved'
        : rev?.decision === 'refused' ? 'refused'
        : 'received'
      rows.push({
        docKey: c.doc_key, scopeKey, label: c.label, providedBy: c.provided_by, required: c.required,
        perApplicantName: t.name,
        state,
        documentId: doc ? String(doc.id) : null,
        filename: doc ? ((doc.filename as string | null) ?? null) : null,
        decision: rev ? {
          by: String(rev.decided_by), role: String(rev.decided_by_role) as ReviewerRole,
          at: String(rev.decided_at), reason: (rev.reason as string | null) ?? null,
        } : null,
      })
    }
  }

  const req = rows.filter(r => r.required)
  const totals = {
    required: req.length,
    received: req.filter(r => r.state !== 'waiting').length,
    decided: req.filter(r => r.state === 'approved' || r.state === 'refused').length,
    approved: req.filter(r => r.state === 'approved').length,
    refused: req.filter(r => r.state === 'refused').length,
    waiting: req.filter(r => r.state === 'waiting').length,
  }
  // Refused counts as decided but NOT as complete: a refusal is a request for
  // a better document, so the window stays shut until it is replaced.
  const complete = req.length > 0 && totals.approved === req.length

  const windowOpenedAt = (app.board_window_opened_at as string | null) ?? null
  const windowDays = (app.board_window_days as number | null) ?? 30
  const dueAt = windowOpenedAt
    ? new Date(new Date(windowOpenedAt).getTime() + windowDays * 86400000).toISOString()
    : null

  return { rows, totals, complete, windowOpenedAt, windowDays, dueAt }
}

/** Open or close the 30-day window to match reality, and report what changed.
 *  Called after every decision and every upload.
 *
 *  Re-opening matters as much as opening: if a document is refused, or a new
 *  requirement appears, the deadline the board was given is no longer the one
 *  the rule describes, so it is cleared rather than left to mislead. */
export async function syncBoardWindow(applicationId: string): Promise<{ opened: boolean; closed: boolean; state: ReviewState | null }> {
  const state = await getReviewState(applicationId)
  if (!state) return { opened: false, closed: false, state: null }
  const now = new Date().toISOString()

  if (state.complete && !state.windowOpenedAt) {
    await supabaseAdmin.from('listing_applications').update({ board_window_opened_at: now, updated_at: now }).eq('id', applicationId)
    return { opened: true, closed: false, state: { ...state, windowOpenedAt: now, dueAt: new Date(Date.now() + state.windowDays * 86400000).toISOString() } }
  }
  if (!state.complete && state.windowOpenedAt) {
    await supabaseAdmin.from('listing_applications').update({ board_window_opened_at: null, updated_at: now }).eq('id', applicationId)
    return { opened: false, closed: true, state: { ...state, windowOpenedAt: null, dueAt: null } }
  }
  return { opened: false, closed: false, state }
}

/** The applicant-facing sentence, identical everywhere it appears. */
export function boardWindowSentence(days = 30): string {
  return `The Board may decide up to ${days} days after the last requested document is received.`
}

export const REVIEW_REMINDER_DAYS = 5
