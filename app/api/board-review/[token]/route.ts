// GET  /api/board-review/[token]        → the document list for this review round
// POST /api/board-review/[token]        → record one decision
//        { scopeKey, decision: 'approved'|'refused', reason?, reviewer }
//
// The board member or on-site manager holding this link. ANY ONE of them
// settles a document (user direction) — the row records who it was and when,
// and a later decision replaces the earlier one rather than stacking.
//
// Token auth, deliberately: a board member should not need an account to
// approve a lease document, and the round's token is the capability.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReviewState, syncBoardWindow, boardWindowSentence, REVIEWER_ROLE_LABEL, type ReviewerRole } from '@/lib/board-review'
import { notifyOfficeOfReviewResponse } from '@/lib/board-review-email'
import { advanceToApprovalSent } from '@/lib/board-decision-letter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Round {
  id: string; application_id: string; association_code: string; unit_label: string | null
  recipients: { name?: string; email?: string; role?: string }[]; note: string | null
}

async function loadRound(token: string): Promise<Round | null> {
  const { data } = await supabaseAdmin.from('document_review_rounds')
    .select('id, application_id, association_code, unit_label, recipients, note')
    .eq('token', token).maybeSingle()
  if (!data) return null
  return {
    id: String(data.id), application_id: String(data.application_id),
    association_code: String(data.association_code), unit_label: (data.unit_label as string | null) ?? null,
    recipients: Array.isArray(data.recipients) ? data.recipients as Round['recipients'] : [],
    note: (data.note as string | null) ?? null,
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const round = await loadRound(token)
  if (!round) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  const [state, { data: assoc }, { data: app }, { data: people }] = await Promise.all([
    getReviewState(round.application_id),
    supabaseAdmin.from('associations').select('legal_name, association_name').eq('association_code', round.association_code).maybeSingle(),
    supabaseAdmin.from('listing_applications').select('application_type').eq('id', round.application_id).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', round.application_id).eq('role', 'applicant').order('is_primary', { ascending: false }),
  ])
  if (!state) return NextResponse.json({ error: 'This application could not be found.' }, { status: 404 })

  return NextResponse.json({
    associationName: (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || round.association_code,
    unitLabel: round.unit_label,
    applicationType: (app?.application_type as string | null) ?? null,
    applicants: (people ?? []).map(p => String(p.name ?? '').trim()).filter(Boolean),
    note: round.note,
    // Who this link was sent to — the reviewer picks which of them they are,
    // so a decision is always attributed to a named person.
    reviewers: round.recipients.filter(r => r.name).map(r => ({ name: String(r.name), role: (r.role ?? 'board') as ReviewerRole })),
    roleLabels: REVIEWER_ROLE_LABEL,
    windowSentence: boardWindowSentence(state.windowDays),
    ...state,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const round = await loadRound(token)
  if (!round) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  let b: { scopeKey?: unknown; decision?: unknown; reason?: unknown; reviewer?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const scopeKey = String(b.scopeKey ?? '').trim()
  const decision = b.decision === 'approved' || b.decision === 'refused' ? b.decision : null
  const reason = String(b.reason ?? '').trim().slice(0, 2000)
  const reviewerName = String((b.reviewer as { name?: string } | undefined)?.name ?? '').trim()
  const reviewerRole = ((b.reviewer as { role?: string } | undefined)?.role ?? 'board') as ReviewerRole
  if (!scopeKey || !decision) return NextResponse.json({ error: 'scopeKey and decision are required' }, { status: 400 })
  if (!reviewerName) return NextResponse.json({ error: 'Tell us who you are before deciding.' }, { status: 400 })
  // A refusal without a reason is the "your application is incomplete" email
  // that started all of this — the applicant must be told what to fix.
  if (decision === 'refused' && reason.length < 4) {
    return NextResponse.json({ error: 'Please say briefly why it is refused — the applicant sees this and needs to know what to fix.' }, { status: 400 })
  }

  const before = await getReviewState(round.application_id)
  const row = before?.rows.find(r => r.scopeKey === scopeKey)
  if (!row) return NextResponse.json({ error: 'That document is not on this application.' }, { status: 404 })
  // Nothing to open, nothing to judge.
  if (row.state === 'waiting') {
    return NextResponse.json({ error: `“${row.label}” has not been uploaded yet, so there is nothing to review.` }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('application_document_reviews').upsert({
    application_id: round.application_id, doc_key: row.docKey, scope_key: scopeKey,
    decision, reason: decision === 'refused' ? reason : null,
    decided_by: reviewerName, decided_by_role: reviewerRole,
    decided_at: new Date().toISOString(), round_id: round.id,
  }, { onConflict: 'application_id,scope_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { opened, state } = await syncBoardWindow(round.application_id)

  // under_review → approval_sent, fully automatic: create + send the board
  // decision letter the instant the checklist just became complete — fires
  // the same way here as it does from the staff side.
  if (opened) await advanceToApprovalSent(round.application_id)

  // PMI + Jonathan hear about every response as it happens — not a digest at
  // the end, so a refusal reaches the office the hour it is raised.
  await notifyOfficeOfReviewResponse({
    applicationId: round.application_id, roundId: round.id,
    label: row.perApplicantName ? `${row.label} — ${row.perApplicantName}` : row.label,
    decision, reason: decision === 'refused' ? reason : null,
    reviewerName, reviewerRole, windowOpened: opened,
  }).catch(() => null)

  return NextResponse.json({ ok: true, windowOpened: opened, ...(state ?? {}) })
}
