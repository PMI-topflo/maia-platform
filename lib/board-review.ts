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
import { getIntakeChecklist, getIntakeChecklistAll, isApplicationType, parseDeclarations, declaredNaKeys, type IntakeDoc } from '@/lib/intake-documents'

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

// ── The raw material one application's state is derived from ─────────
// Named so the single-application reader and the dashboard's batched reader
// can hand the SAME shape to the SAME derivation. The rule at the top of this
// file is decided once, in deriveReviewState, and nowhere else.

export interface ReviewInputs {
  app: {
    na_items: unknown
    declarations: unknown
    board_window_opened_at: string | null
    board_window_days: number | null
  }
  checklist: IntakeDoc[]
  docs: { id: string; doc_key: string; filename: string | null; stakeholder_id: string | null }[]
  reviews: { scope_key: string; decision: string; reason: string | null; decided_by: string; decided_by_role: string; decided_at: string }[]
  /** Applicants, primary first. */
  people: { id: string; name: string | null; applicant_role: string | null }[]
  petsAllowed: boolean | null
}

/** Read the whole review state for ONE application. One query set, one truth. */
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

  return deriveReviewState({
    app: {
      na_items: app.na_items, declarations: app.declarations,
      board_window_opened_at: (app.board_window_opened_at as string | null) ?? null,
      board_window_days: (app.board_window_days as number | null) ?? null,
    },
    checklist,
    docs: (docs ?? []).map(d => ({ id: String(d.id), doc_key: String(d.doc_key), filename: (d.filename as string | null) ?? null, stakeholder_id: d.stakeholder_id ? String(d.stakeholder_id) : null })),
    reviews: (reviews ?? []).map(r => ({ scope_key: String(r.scope_key), decision: String(r.decision), reason: (r.reason as string | null) ?? null, decided_by: String(r.decided_by), decided_by_role: String(r.decided_by_role), decided_at: String(r.decided_at) })),
    people: (people ?? []).map(p => ({ id: String(p.id), name: (p.name as string | null) ?? null, applicant_role: (p.applicant_role as string | null) ?? null })),
    petsAllowed: (assoc?.pets_allowed as boolean | null) ?? null,
  })
}

/** The derivation itself — pure, so it cannot drift between the one-application
 *  screens and the dashboards that roll many of them up. */
export function deriveReviewState({ app, checklist, docs, reviews, people, petsAllowed }: ReviewInputs): ReviewState {
  // Items the applicant's own declaration retired ("I keep no vehicle") are not
  // outstanding — they do not apply, so they must never hold the window shut.
  const declarations = parseDeclarations(app.declarations)
  const na = new Set([
    ...(Array.isArray(app.na_items) ? (app.na_items as string[]) : []),
    ...declaredNaKeys(checklist, declarations, { petsAllowed }),
  ])
  const isNa = (docKey: string, sid: string | null) => na.has(docKey) || (!!sid && na.has(`${docKey}#${sid}`))

  const byScope = new Map(reviews.map(r => [r.scope_key, r]))
  // Minors don't hold up a review — they provide nothing.
  const applicants = people.filter(p => (p.applicant_role ?? '') !== 'minor_dependent')

  const rows: ReviewRow[] = []
  for (const c of checklist) {
    const targets: { sid: string | null; name: string | null }[] = c.per_applicant && applicants.length
      ? applicants.map(a => ({ sid: a.id, name: a.name }))
      : [{ sid: null, name: null }]

    for (const t of targets) {
      if (isNa(c.doc_key, t.sid)) continue
      const scopeKey = scoped(c.doc_key, t.sid)
      // A SHARED item is satisfied by whoever uploaded it; a per-applicant item
      // is strictly that person's.
      const doc = t.sid
        ? docs.find(d => d.doc_key === c.doc_key && (d.stakeholder_id ?? '') === t.sid)
        : docs.find(d => d.doc_key === c.doc_key)
      const rev = byScope.get(scopeKey)
      const state: DocState = !doc ? 'waiting'
        : rev?.decision === 'approved' ? 'approved'
        : rev?.decision === 'refused' ? 'refused'
        : 'received'
      rows.push({
        docKey: c.doc_key, scopeKey, label: c.label, providedBy: c.provided_by, required: c.required,
        perApplicantName: t.name,
        state,
        documentId: doc ? doc.id : null,
        filename: doc ? doc.filename : null,
        decision: rev ? {
          by: rev.decided_by, role: rev.decided_by_role as ReviewerRole,
          at: rev.decided_at, reason: rev.reason,
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

  const windowOpenedAt = app.board_window_opened_at
  const windowDays = app.board_window_days ?? 30
  const dueAt = windowOpenedAt
    ? new Date(new Date(windowOpenedAt).getTime() + windowDays * 86400000).toISOString()
    : null

  return { rows, totals, complete, windowOpenedAt, windowDays, dueAt }
}

/** The same state for MANY applications, in a fixed number of queries rather
 *  than five per application. Used by the dashboards, which roll up dozens at
 *  a time; the per-application reader above would issue hundreds.
 *
 *  Both paths end in deriveReviewState, so a dashboard can never show a
 *  different answer from the screen it links to. */
export async function getReviewStates(applicationIds: string[]): Promise<Map<string, ReviewState>> {
  const out = new Map<string, ReviewState>()
  const ids = [...new Set(applicationIds.map(String))].filter(Boolean)
  if (!ids.length) return out

  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, application_type, na_items, declarations, board_window_opened_at, board_window_days')
    .in('id', ids)
  if (!apps?.length) return out

  const codes = [...new Set(apps.map(a => String(a.association_code ?? '').toUpperCase()).filter(Boolean))]
  const [{ data: docs }, { data: reviews }, { data: people }, { data: assocs }, checklistsByCode] = await Promise.all([
    supabaseAdmin.from('application_documents').select('id, application_id, doc_key, filename, stakeholder_id').in('application_id', ids),
    supabaseAdmin.from('application_document_reviews').select('application_id, scope_key, decision, reason, decided_by, decided_by_role, decided_at').in('application_id', ids),
    supabaseAdmin.from('application_stakeholders').select('id, application_id, name, applicant_role').eq('role', 'applicant').in('application_id', ids)
      .order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    codes.length ? supabaseAdmin.from('associations').select('association_code, pets_allowed').in('association_code', codes) : Promise.resolve({ data: [] }),
    // One checklist read per ASSOCIATION, not per application.
    Promise.all(codes.map(async c => [c, await getIntakeChecklistAll(c)] as const)).then(e => new Map(e)),
  ])

  const petsBy = new Map((assocs ?? []).map(a => [String(a.association_code).toUpperCase(), (a.pets_allowed as boolean | null) ?? null]))
  const group = <T extends { application_id: unknown }>(rows: T[] | null) => {
    const m = new Map<string, T[]>()
    for (const r of rows ?? []) {
      const k = String(r.application_id)
      const arr = m.get(k); if (arr) arr.push(r); else m.set(k, [r])
    }
    return m
  }
  const docsBy = group(docs), reviewsBy = group(reviews), peopleBy = group(people)

  for (const a of apps) {
    const id = String(a.id)
    const code = String(a.association_code ?? '').toUpperCase()
    const type = String(a.application_type ?? '')
    const checklist = isApplicationType(type) ? (checklistsByCode.get(code)?.[type] ?? []) : []
    out.set(id, deriveReviewState({
      app: {
        na_items: a.na_items, declarations: a.declarations,
        board_window_opened_at: (a.board_window_opened_at as string | null) ?? null,
        board_window_days: (a.board_window_days as number | null) ?? null,
      },
      checklist,
      docs: (docsBy.get(id) ?? []).map(d => ({ id: String(d.id), doc_key: String(d.doc_key), filename: (d.filename as string | null) ?? null, stakeholder_id: d.stakeholder_id ? String(d.stakeholder_id) : null })),
      reviews: (reviewsBy.get(id) ?? []).map(r => ({ scope_key: String(r.scope_key), decision: String(r.decision), reason: (r.reason as string | null) ?? null, decided_by: String(r.decided_by), decided_by_role: String(r.decided_by_role), decided_at: String(r.decided_at) })),
      people: (peopleBy.get(id) ?? []).map(p => ({ id: String(p.id), name: (p.name as string | null) ?? null, applicant_role: (p.applicant_role as string | null) ?? null })),
      petsAllowed: petsBy.get(code) ?? null,
    }))
  }
  return out
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
    // submitted → under_review, automatic — every required document is now
    // individually approved, whether that was completed by staff or by a
    // board member (both paths call this same function, so it fires the
    // same way either way). User direction, 2026-08-20. Scoped to
    // 'submitted' only: an application that reaches complete again later
    // (e.g. a refused document gets corrected after approval/decline) is
    // never moved backward from here — the fallback update below still
    // opens the window itself in that case, just without touching status.
    const { data: flipped } = await supabaseAdmin.from('listing_applications')
      .update({ board_window_opened_at: now, updated_at: now, status: 'under_review' })
      .eq('id', applicationId).eq('status', 'submitted').select('id')
    if (!flipped?.length) {
      await supabaseAdmin.from('listing_applications').update({ board_window_opened_at: now, updated_at: now }).eq('id', applicationId)
    }
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
