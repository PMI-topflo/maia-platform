// =====================================================================
// lib/application-dashboard.ts
//
// The applications dashboard, for staff, the board and the on-site manager.
//
// The three of them look at the same pipeline from three desks, so they get
// the same numbers from this one file. What they do NOT share is whose turn
// it is — and that is the only question a dashboard is actually for.
//
// A document count answers nothing. "14 documents" is true of an application
// nobody has touched in three weeks and of one that is finished. So every row
// here is reduced to ONE fact — who owes the next action — and one clock: how
// long they have owed it, and, once the 30-day window is open, how long is
// left. See lib/board-review.ts for the window rule itself; this file never
// re-decides it, it only reports it.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReviewStates, type ReviewState } from '@/lib/board-review'

/** Who owes the next action. In the order the pipeline reaches them. */
export type Stage =
  | 'applicant'   // required documents have not arrived
  | 'refused'     // a document was sent back; a replacement must come in
  | 'not_sent'    // everything arrived — but nobody has been asked to review it
  | 'review'      // the board / on-site manager must decide on the documents
  | 'letter'      // documents all approved; the Board Decision is not written
  | 'signature'   // the Board Decision is out, awaiting signatures
  | 'decided'     // approved or declined; nothing owed

export type Owner = 'applicant' | 'staff' | 'board'

/** Whose desk each stage sits on. The dashboards lead with the viewer's own. */
export const STAGE_OWNER: Record<Stage, Owner> = {
  applicant: 'applicant',
  refused:   'applicant',
  not_sent:  'staff',
  review:    'board',
  letter:    'staff',
  signature: 'board',
  decided:   'staff',
}

/** Written for the person waiting, not for the database. */
export const STAGE_LABEL: Record<Stage, string> = {
  applicant: 'Waiting on documents',
  refused:   'Sent back — awaiting a replacement',
  not_sent:  'Ready to send to the board',
  review:    'With the board to review',
  letter:    'Ready for the Board Decision',
  signature: 'Awaiting board signatures',
  decided:   'Decided',
}

export const STAGE_ORDER: Stage[] = ['refused', 'not_sent', 'review', 'letter', 'signature', 'applicant', 'decided']

/** An application is stalled when the same person has owed the same action
 *  this long. Not a rule of the association's — a working threshold, so a
 *  quiet application surfaces before somebody complains. */
export const STALLED_DAYS = 14
/** The window is worth flagging this close to its end. */
export const DUE_SOON_DAYS = 7

export type Alarm = 'overdue' | 'due_soon' | 'stalled'

export interface DashboardRow {
  id: string
  associationCode: string
  associationName: string
  unit: string | null
  type: string
  status: string
  createdAt: string
  submittedAt: string | null
  reviewedAt: string | null
  applicants: string[]
  driveFolderUrl: string | null

  stage: Stage
  owner: Owner
  /** One line naming what is actually outstanding — the documents, or the people. */
  detail: string
  /** Up to four outstanding items, named, so the row is actionable without opening it. */
  outstanding: string[]

  /** When the current wait began, and how long it has run. */
  sinceAt: string | null
  waitingDays: number | null

  /** The 30-day window (null until every required document is in and approved). */
  windowOpenedAt: string | null
  dueAt: string | null
  daysLeft: number | null

  alarm: Alarm | null

  totals: ReviewState['totals']
  /** The newest review round's link, so a reviewer can go straight to it. */
  reviewUrl: string | null
  reviewSentAt: string | null
  /** Board Decision letter, when one exists for this unit. */
  letter: { status: string; signed: number; of: number } | null
}

export interface Dashboard {
  rows: DashboardRow[]
  counts: Record<Stage, number>
  /** Rows needing attention now, most urgent first — the top of every view. */
  alarms: { overdue: number; dueSoon: number; stalled: number }
  generatedAt: string
}

const DAY = 86400000
const daysSince = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null
/** Rounds AWAY from now in both directions, so an application twelve hours past
 *  its deadline reads "1 day past" and never "0 days left". */
const daysUntil = (iso: string | null) => {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return ms >= 0 ? Math.ceil(ms / DAY) : -Math.ceil(-ms / DAY)
}

/** "Driver's licence, Vehicle registration and 2 more" */
function list(items: string[], max = 3): string {
  if (!items.length) return ''
  if (items.length <= max) return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`
}

const rowLabel = (r: ReviewState['rows'][number]) => r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label

export interface StageInput {
  status: string
  state: ReviewState | null
  /** A review round exists — somebody has actually been asked. */
  hasRound: boolean
  roundSentAt: string | null
  /** A Board Decision letter exists for this application. */
  hasLetter: boolean
  createdAt: string
  submittedAt: string | null
  reviewedAt: string | null
}

/**
 * Whose turn it is, and since when. Pure, and exported, because this is the
 * single judgement the whole dashboard rests on — and because the order of
 * these branches IS the rule.
 *
 * The order matters more than any one branch:
 *   refused before waiting  — a refusal is a specific instruction to replace
 *                             one document, and it must not be buried inside a
 *                             generic "still waiting on documents".
 *   waiting before review   — the board cannot review what has not arrived
 *                             (lib/board-review.ts), so an application with a
 *                             gap is never described as being with them.
 *   not_sent vs review      — identical on a status column, and the difference
 *                             is everything: one is waiting on the board, the
 *                             other is waiting on the office to ask them.
 */
export function decideStage(i: StageInput): { stage: Stage; outstanding: string[]; sinceAt: string | null } {
  const totals = i.state?.totals ?? { required: 0, received: 0, decided: 0, approved: 0, refused: 0, waiting: 0 }
  const reqRows = (i.state?.rows ?? []).filter(r => r.required)
  const submittedOrCreated = i.submittedAt ?? i.createdAt

  if (i.status === 'approved' || i.status === 'declined') {
    return { stage: 'decided', outstanding: [], sinceAt: i.reviewedAt }
  }
  if (totals.refused > 0) {
    const refused = reqRows.filter(r => r.state === 'refused')
    return {
      stage: 'refused',
      outstanding: refused.map(rowLabel),
      // The clock runs from the most recent refusal — that is when the
      // applicant was last told something.
      sinceAt: refused.map(r => r.decision?.at).filter(Boolean).sort().slice(-1)[0] ?? null,
    }
  }
  if (totals.waiting > 0) {
    return { stage: 'applicant', outstanding: reqRows.filter(r => r.state === 'waiting').map(rowLabel), sinceAt: submittedOrCreated }
  }
  if (totals.required > 0 && totals.decided < totals.required) {
    return {
      stage: i.hasRound ? 'review' : 'not_sent',
      outstanding: reqRows.filter(r => r.state === 'received').map(rowLabel),
      sinceAt: i.roundSentAt ?? submittedOrCreated,
    }
  }
  if (i.state?.complete) {
    return { stage: i.hasLetter ? 'signature' : 'letter', outstanding: [], sinceAt: i.state.windowOpenedAt }
  }
  // No checklist configured, or nothing required of anybody. There is nothing
  // to chase, and "waiting on documents" would be a lie.
  return { stage: i.hasRound ? 'review' : 'not_sent', outstanding: [], sinceAt: submittedOrCreated }
}

export interface DashboardOptions {
  /** Restrict to one association. Board and on-site manager are always scoped. */
  associationCode?: string | null
  /** Include applications already approved or declined (default true). */
  includeDecided?: boolean
  /** Drop applications the applicant has not submitted yet. The board's view
   *  uses this: chasing a half-finished upload is the office's job, and a
   *  reviewer has nothing to open. */
  submittedOnly?: boolean
  limit?: number
}

/**
 * Every open application, reduced to whose turn it is.
 *
 * Deliberately includes `started` applications — an applicant part-way through
 * uploading is the single easiest thing in this pipeline to lose, and it is
 * invisible on any status-based view until they press submit.
 */
export async function getApplicationDashboard(opts: DashboardOptions = {}): Promise<Dashboard> {
  const { associationCode = null, includeDecided = true, submittedOnly = false, limit = 300 } = opts

  const statuses = includeDecided
    ? ['started', 'submitted', 'under_review', 'approval_sent', 'approved', 'declined']
    : ['started', 'submitted', 'under_review', 'approval_sent']

  let q = supabaseAdmin.from('listing_applications')
    .select('id, association_code, application_type, unit_label, status, created_at, submitted_at, reviewed_at, drive_folder_url')
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (associationCode) q = q.eq('association_code', associationCode.toUpperCase())
  if (submittedOnly) q = q.not('submitted_at', 'is', null)
  const { data: apps } = await q

  const rows: DashboardRow[] = []
  const counts = { applicant: 0, refused: 0, not_sent: 0, review: 0, letter: 0, signature: 0, decided: 0 } as Record<Stage, number>
  const alarms = { overdue: 0, dueSoon: 0, stalled: 0 }
  if (!apps?.length) return { rows, counts, alarms, generatedAt: new Date().toISOString() }

  const ids = apps.map(a => String(a.id))
  const codes = [...new Set(apps.map(a => String(a.association_code ?? '').toUpperCase()).filter(Boolean))]
  const units = [...new Set(apps.map(a => String(a.unit_label ?? '')).filter(Boolean))]

  const [states, { data: people }, { data: rounds }, { data: assocs }, { data: letters }] = await Promise.all([
    getReviewStates(ids),
    supabaseAdmin.from('application_stakeholders').select('application_id, name').eq('role', 'applicant').in('application_id', ids)
      .order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    supabaseAdmin.from('document_review_rounds').select('application_id, token, created_at, recipients').in('application_id', ids)
      .order('created_at', { ascending: false }),
    codes.length ? supabaseAdmin.from('associations').select('association_code, association_name, legal_name').in('association_code', codes) : Promise.resolve({ data: [] }),
    // The Board Decision letter is keyed by association + unit, not by
    // application — so it is matched back by unit and only counted when it was
    // created AFTER the application, never a previous tenancy's letter.
    codes.length && units.length
      ? supabaseAdmin.from('esign_documents').select('association_code, unit_ref, status, signers, created_at')
          .eq('kind', 'board_decision').in('association_code', codes).in('unit_ref', units)
          .neq('status', 'void').order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  const nameBy = new Map<string, string[]>()
  for (const p of people ?? []) {
    const k = String(p.application_id), n = String(p.name ?? '').trim()
    if (!n) continue
    const arr = nameBy.get(k); if (arr) arr.push(n); else nameBy.set(k, [n])
  }
  // Newest round per application (the query is already newest-first).
  const roundBy = new Map<string, { token: string; created_at: string }>()
  for (const r of rounds ?? []) {
    const k = String(r.application_id)
    if (!roundBy.has(k)) roundBy.set(k, { token: String(r.token), created_at: String(r.created_at) })
  }
  const assocBy = new Map((assocs ?? []).map(a => [
    String(a.association_code).toUpperCase(),
    (a.association_name as string | null) || (a.legal_name as string | null) || String(a.association_code),
  ]))
  const letterBy = new Map<string, { status: string; signers: { signed_at?: string }[]; created_at: string }>()
  for (const l of letters ?? []) {
    const k = `${String(l.association_code).toUpperCase()}|${String(l.unit_ref ?? '')}`
    if (!letterBy.has(k)) letterBy.set(k, { status: String(l.status), signers: (Array.isArray(l.signers) ? l.signers : []) as { signed_at?: string }[], created_at: String(l.created_at) })
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

  for (const a of apps) {
    const id = String(a.id)
    const code = String(a.association_code ?? '').toUpperCase()
    const unit = (a.unit_label as string | null) ?? null
    const status = String(a.status)
    const state = states.get(id)
    const round = roundBy.get(id) ?? null
    const createdAt = String(a.created_at)

    const rawLetter = unit ? letterBy.get(`${code}|${unit}`) ?? null : null
    // A letter predating the application belongs to a previous tenancy.
    const lt = rawLetter && new Date(rawLetter.created_at).getTime() >= new Date(createdAt).getTime() ? rawLetter : null
    const letter = lt ? { status: lt.status, signed: lt.signers.filter(s => !!s.signed_at).length, of: lt.signers.length } : null

    const totals = state?.totals ?? { required: 0, received: 0, decided: 0, approved: 0, refused: 0, waiting: 0 }

    const { stage, outstanding, sinceAt } = decideStage({
      status, state: state ?? null,
      hasRound: !!round, roundSentAt: round?.created_at ?? null,
      hasLetter: !!letter,
      createdAt, submittedAt: (a.submitted_at as string | null) ?? null,
      reviewedAt: (a.reviewed_at as string | null) ?? null,
    })

    const daysLeft = daysUntil(state?.dueAt ?? null)
    const waitingDays = daysSince(sinceAt)
    const alarm: Alarm | null =
      stage === 'decided' ? null
      : daysLeft != null && daysLeft < 0 ? 'overdue'
      : daysLeft != null && daysLeft <= DUE_SOON_DAYS ? 'due_soon'
      : waitingDays != null && waitingDays >= STALLED_DAYS ? 'stalled'
      : null

    const applicants = nameBy.get(id) ?? []
    const detail =
      stage === 'decided' ? (status === 'approved' ? 'Approved' : 'Declined')
      : stage === 'refused' ? `Sent back: ${list(outstanding)}`
      : stage === 'applicant' ? `Still to come: ${list(outstanding)}`
      : stage === 'not_sent' ? `${totals.received - totals.decided} document${totals.received - totals.decided === 1 ? '' : 's'} on file that nobody has been asked to review`
      : stage === 'review' ? `${outstanding.length} to decide: ${list(outstanding)}`
      : stage === 'letter' ? 'Every document approved — write the Board Decision'
      : letter ? `${letter.signed} of ${letter.of} signatures` : 'Awaiting signatures'

    counts[stage]++
    if (alarm === 'overdue') alarms.overdue++
    else if (alarm === 'due_soon') alarms.dueSoon++
    else if (alarm === 'stalled') alarms.stalled++

    rows.push({
      id, associationCode: code, associationName: assocBy.get(code) ?? code, unit,
      type: String(a.application_type ?? ''), status, createdAt,
      submittedAt: (a.submitted_at as string | null) ?? null,
      reviewedAt: (a.reviewed_at as string | null) ?? null, applicants,
      driveFolderUrl: (a.drive_folder_url as string | null) ?? null,
      stage, owner: STAGE_OWNER[stage], detail, outstanding: outstanding.slice(0, 4),
      sinceAt, waitingDays,
      windowOpenedAt: state?.windowOpenedAt ?? null, dueAt: state?.dueAt ?? null, daysLeft,
      alarm, totals,
      reviewUrl: round ? `${base}/board-review/${round.token}` : null,
      reviewSentAt: round?.created_at ?? null,
      letter,
    })
  }

  // Most urgent first: overdue, then due soon, then stalled, then by how long
  // somebody has been waiting. A decided application never outranks an open one.
  const rank = (r: DashboardRow) =>
    r.stage === 'decided' ? 4 : r.alarm === 'overdue' ? 0 : r.alarm === 'due_soon' ? 1 : r.alarm === 'stalled' ? 2 : 3
  rows.sort((x, y) => rank(x) - rank(y) || (y.waitingDays ?? 0) - (x.waitingDays ?? 0))

  return { rows, counts, alarms, generatedAt: new Date().toISOString() }
}
