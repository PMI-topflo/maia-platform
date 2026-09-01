// =====================================================================
// scripts/test-review-state.ts   —   npm run test:review
//
// The per-document review state and the 30-day window, exercised directly,
// plus the dashboard's judgement of whose turn it is.
//
// Both are pure functions now precisely so they can be run without a database:
// deriveReviewState is what the board's screen, the reviewer's link, the
// request emails, the reminder cron AND the three dashboards all read, and
// decideStage is the one sentence each dashboard row is reduced to.
//
// THE RULE UNDER TEST (lib/board-review.ts): the Board may decide up to 30 days
// after the last requested document is RECEIVED. Two things fall out of it and
// both are easy to break silently:
//   · a document that has not arrived cannot be reviewed (cases 1-3);
//   · the window opens only when everything required is in AND approved, and a
//     refusal closes it again (cases 5-6).
// =====================================================================

import { deriveReviewState, type ReviewInputs } from '../lib/board-review'
import { decideStage, STAGE_OWNER, type StageInput } from '../lib/application-dashboard'
import type { IntakeDoc } from '../lib/intake-documents'

let fails = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  const ok = g === w
  if (!ok) fails++
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}${ok ? '' : `\n      got  ${g}\n      want ${w}`}`)
}

// ── Builders ─────────────────────────────────────────────────────────
const doc = (doc_key: string, over: Partial<IntakeDoc> = {}): IntakeDoc => ({
  id: doc_key, doc_key, label: doc_key, provided_by: 'applicant', required: true,
  note: null, sort_order: 0, template_path: null, requires_notarization: false,
  per_applicant: false, allow_multiple: false, condition_key: null, ...over,
})

const ANNA = { id: 'p1', name: 'Anna', applicant_role: 'primary_applicant' }
const BEN = { id: 'p2', name: 'Ben', applicant_role: 'co_applicant' }
const KID = { id: 'p3', name: 'Kid', applicant_role: 'minor_dependent' }

const state = (over: Partial<ReviewInputs> = {}) => deriveReviewState({
  app: { na_items: [], declarations: {}, board_window_opened_at: null, board_window_days: null },
  checklist: [doc('drivers_license'), doc('signed_lease')],
  docs: [], reviews: [], people: [ANNA], petsAllowed: true, ...over,
})

const file = (doc_key: string, stakeholder_id: string | null = null, created_at = '2026-08-01T00:00:00.000Z') =>
  ({ id: `f-${doc_key}-${stakeholder_id ?? 'shared'}`, doc_key, filename: `${doc_key}.pdf`, stakeholder_id, created_at })
const review = (scope_key: string, decision: 'approved' | 'refused', reason: string | null = null) =>
  ({ scope_key, decision, reason, decided_by: 'Walter Giles', decided_by_role: 'board', decided_at: '2026-08-10T12:00:00.000Z' })

const states = (s: ReturnType<typeof state>) => s.rows.map(r => `${r.scopeKey}:${r.state}`)

// ── 1. Nothing uploaded ──────────────────────────────────────────────
// Waiting on an UPLOAD, never on a decision. This is the distinction the old
// single "saved" state lost, and the reason the whole feature exists.
eq('nothing uploaded → every row waiting', states(state()), ['drivers_license:waiting', 'signed_lease:waiting'])
eq('nothing uploaded → window shut', state().complete, false)
eq('nothing uploaded → no due date', state().dueAt, null)

// ── 2. Arrived, but nobody has read it ───────────────────────────────
// "received" is not "approved". Green must mean a human looked.
const arrived = state({ docs: [file('drivers_license')] })
eq('uploaded but undecided → received', states(arrived), ['drivers_license:received', 'signed_lease:waiting'])
eq('received is not complete', arrived.complete, false)
eq('received counts as received, not decided', [arrived.totals.received, arrived.totals.decided], [1, 0])

// ── 3. A document that has not arrived cannot be approved ────────────
// A stray review row for a file nobody uploaded must not fake an approval.
const ghost = state({ reviews: [review('drivers_license', 'approved')] })
eq('approval without an upload stays waiting', states(ghost), ['drivers_license:waiting', 'signed_lease:waiting'])
eq('approval without an upload does not complete', ghost.complete, false)

// ── 4. Everything in and approved → the window opens ─────────────────
const done = state({
  docs: [file('drivers_license'), file('signed_lease')],
  reviews: [review('drivers_license', 'approved'), review('signed_lease', 'approved')],
})
eq('all approved → complete', done.complete, true)
eq('all approved → totals', [done.totals.approved, done.totals.required], [2, 2])

// ── 5. A refusal closes it again ─────────────────────────────────────
// Refused is DECIDED but not COMPLETE: it is a request for a better document.
const refused = state({
  docs: [file('drivers_license'), file('signed_lease')],
  reviews: [review('drivers_license', 'approved'), review('signed_lease', 'refused', 'Unsigned by the landlord')],
})
eq('a refusal decides the row', refused.totals.decided, 2)
eq('a refusal blocks completion', refused.complete, false)
eq('the refusal reason survives', refused.rows.find(r => r.docKey === 'signed_lease')?.decision?.reason, 'Unsigned by the landlord')

// ── 5b. A document refiled AFTER a decision clears that stale decision ──
// A decision is stamped on the CHECKLIST ITEM, not on any one uploaded file —
// re-uploading, a Drive scan/pick, or a resent e-signed form never itself
// touches application_document_reviews. Real case, 2026-09-01 (MANXI 303,
// Wilner Florestan): a resent, corrected Maintenance Assessment
// Acknowledgment landed under the OLD refusal and never surfaced as
// something new to review. A decision only counts when it was made ON OR
// AFTER the current document's own created_at.
const refiledAfterRefusal = state({
  docs: [file('signed_lease', null, '2026-08-15T00:00:00.000Z')],   // uploaded AFTER the refusal below
  reviews: [review('signed_lease', 'refused', 'Unsigned by the landlord')],   // decided_at 2026-08-10
})
eq('a document refiled after a refusal clears it back to received', states(refiledAfterRefusal), ['drivers_license:waiting', 'signed_lease:received'])
eq('the stale refusal reason does not carry over', refiledAfterRefusal.rows.find(r => r.docKey === 'signed_lease')?.decision, null)
// A decision made AFTER the current document is still honored — approving or
// re-refusing the new file must keep working exactly as before.
const decidedAfterRefile = state({
  docs: [file('signed_lease', null, '2026-08-01T00:00:00.000Z')],
  reviews: [review('signed_lease', 'approved')],   // decided_at 2026-08-10, after the upload
})
eq('a decision made after the current document still applies', states(decidedAfterRefile), ['drivers_license:waiting', 'signed_lease:approved'])

// ── 6. The 30-day window is opened+days, and days are configurable ───
const open30 = state({
  app: { na_items: [], declarations: {}, board_window_opened_at: '2026-08-01T00:00:00.000Z', board_window_days: null },
})
eq('default window is 30 days', open30.windowDays, 30)
eq('due = opened + 30 days', open30.dueAt, '2026-08-31T00:00:00.000Z')
const open45 = state({
  app: { na_items: [], declarations: {}, board_window_opened_at: '2026-08-01T00:00:00.000Z', board_window_days: 45 },
})
eq('a longer window is honoured', open45.dueAt, '2026-09-15T00:00:00.000Z')

// ── 7. Optional items never hold the window shut ─────────────────────
const optional = state({
  checklist: [doc('drivers_license'), doc('pet_registration', { required: false })],
  docs: [file('drivers_license')],
  reviews: [review('drivers_license', 'approved')],
})
eq('an optional item is listed', optional.rows.length, 2)
eq('an optional item is not counted as required', optional.totals.required, 1)
eq('a missing optional item still completes', optional.complete, true)

// ── 8. Marked N/A drops out entirely ─────────────────────────────────
const na = state({
  app: { na_items: ['signed_lease'], declarations: {}, board_window_opened_at: null, board_window_days: null },
  docs: [file('drivers_license')],
  reviews: [review('drivers_license', 'approved')],
})
eq('an N/A item is not a row at all', states(na), ['drivers_license:approved'])
eq('an N/A item cannot hold the window shut', na.complete, true)

// ── 9. A declaration retires items the same way ──────────────────────
// "I keep no vehicle" — the bug this gate was built for: a car-free applicant
// who could never reach complete.
const carFree = state({
  app: { na_items: [], declarations: { vehicle: { has: false } }, board_window_opened_at: null, board_window_days: null },
  checklist: [doc('drivers_license'), doc('car_registration', { condition_key: 'vehicle' })],
  docs: [file('drivers_license')],
  reviews: [review('drivers_license', 'approved')],
})
eq('a declared "no vehicle" retires the vehicle document', states(carFree), ['drivers_license:approved'])
eq('a car-free applicant can reach complete', carFree.complete, true)

// ── 10. Per-applicant items expand; minors do not ────────────────────
// A minor provides nothing, so they must never hold up a review.
const perPerson = state({
  checklist: [doc('id_document', { per_applicant: true })],
  people: [ANNA, BEN, KID],
})
eq('a per-applicant item expands per adult only', states(perPerson), ['id_document#p1:waiting', 'id_document#p2:waiting'])
eq('one applicant is named on their own row', perPerson.rows[0].perApplicantName, 'Anna')

// One person's document can be refused without touching the other's.
const oneRefused = state({
  checklist: [doc('id_document', { per_applicant: true })],
  people: [ANNA, BEN],
  docs: [file('id_document', 'p1'), file('id_document', 'p2')],
  reviews: [review('id_document#p1', 'approved'), review('id_document#p2', 'refused', 'Expired')],
})
eq('per-applicant decisions are independent', states(oneRefused), ['id_document#p1:approved', 'id_document#p2:refused'])

// ── 11. A SHARED item is satisfied by whoever uploaded it ────────────
// Applicant uploads carry the uploader's stakeholder_id; requiring an unscoped
// row made them read "Missing".
const shared = state({
  checklist: [doc('signed_lease')],
  docs: [file('signed_lease', 'p1')],
})
eq('a shared item is satisfied by any uploader', states(shared), ['signed_lease:received'])

// ── 12. An empty checklist completes nothing ─────────────────────────
// req.length > 0 is deliberate: "no requirements" is not "all requirements met".
eq('an empty checklist is not complete', state({ checklist: [] }).complete, false)

// =====================================================================
// The dashboard's judgement: whose turn is it.
// =====================================================================
const S = (over: Partial<StageInput> = {}): StageInput => ({
  status: 'submitted', state: state(), hasRound: false, roundSentAt: null, hasLetter: false,
  createdAt: '2026-08-01T00:00:00.000Z', submittedAt: '2026-08-02T00:00:00.000Z', reviewedAt: null, ...over,
})
const stage = (over: Partial<StageInput> = {}) => decideStage(S(over)).stage

// 13. Documents outstanding → the applicant's turn.
eq('waiting documents → applicant', stage(), 'applicant')
eq('the applicant is named as the owner', STAGE_OWNER[stage()], 'applicant')

// 14. THE DISTINCTION THAT MATTERS: everything is in, but was anyone asked?
// These two are identical on a status column, and an application can sit
// "under review" that no reviewer has ever been sent.
eq('all in, nobody asked → the office owes it', stage({ state: arrived_all(), hasRound: false }), 'not_sent')
eq('all in, reviewers asked → the board owes it', stage({ state: arrived_all(), hasRound: true }), 'review')
eq('not_sent belongs to staff', STAGE_OWNER['not_sent'], 'staff')
eq('review belongs to the board', STAGE_OWNER['review'], 'board')

// 15. A refusal outranks a plain gap — it is a specific instruction to replace
//     one document and must not be buried in "still waiting on documents".
const mixed = state({
  checklist: [doc('a'), doc('b')],
  docs: [file('a')],
  reviews: [review('a', 'refused', 'Illegible')],
})
eq('a refusal outranks a missing document', decideStage(S({ state: mixed })).stage, 'refused')
eq('the refused document is what is named', decideStage(S({ state: mixed })).outstanding, ['a'])

// 16. A gap outranks review — the board cannot review what has not arrived.
eq('a gap is never described as being with the board', stage({ state: arrived, hasRound: true }), 'applicant')

// 17. Complete → the letter, then the signatures.
eq('complete, no letter → the office writes it', stage({ state: done, hasRound: true }), 'letter')
eq('complete, letter out → the board signs it', stage({ state: done, hasRound: true, hasLetter: true }), 'signature')
eq('letter belongs to staff', STAGE_OWNER['letter'], 'staff')
eq('signature belongs to the board', STAGE_OWNER['signature'], 'board')

// 18. Decided is decided, whatever the documents say.
eq('approved → decided', stage({ status: 'approved', state: arrived }), 'decided')
eq('declined → decided', stage({ status: 'declined', state: mixed }), 'decided')
eq('the decision date is the clock', decideStage(S({ status: 'approved', reviewedAt: '2026-08-12T00:00:00.000Z' })).sinceAt, '2026-08-12T00:00:00.000Z')

// 19. The clock starts when the reviewers were asked, not when it was submitted.
eq('review waits from the round, not the submission',
  decideStage(S({ state: arrived_all(), hasRound: true, roundSentAt: '2026-08-09T00:00:00.000Z' })).sinceAt,
  '2026-08-09T00:00:00.000Z')

// 20. No checklist at all → nothing to chase, and we must not claim otherwise.
eq('no checklist → not "waiting on documents"', stage({ state: state({ checklist: [] }) }), 'not_sent')

function arrived_all() {
  return state({ docs: [file('drivers_license'), file('signed_lease')] })
}

console.log(fails === 0 ? '\nAll review-state cases pass.' : `\n${fails} FAILING`)
process.exit(fails === 0 ? 0 : 1)
