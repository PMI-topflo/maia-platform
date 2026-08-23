// POST /api/board-review/[token]/finalize   { action: 'approve' | 'send_back', reviewer, note? }
//
// The reviewer's OVERALL verdict on the whole application, distinct from the
// per-document Approve/Refuse buttons on the main page. User direction,
// 2026-08-22 (MANXI 303, the first real application through the automatic
// pipeline): "the final 2 Buttons that still does not exist - should be:
// Send Back or Approve — send back opens a text for them to fill and send
// me back an email with the items not approved and the text - or if
// approved generates and send already the approval letter for signature."
//
// 'approve': the letter this action would create is the SAME one the
// automatic pipeline already creates the instant every document is approved
// (lib/board-decision-letter.ts). If the association requires an interview
// for this application type and it hasn't been held yet, this requests it
// instead — even for an application whose letter already exists (see the
// interview check below); otherwise, checked for an existing letter first so
// a reviewer clicking this on an application already past that point gets
// told it's already out, not a duplicate letter.
// 'send_back': lib/board-review-email.ts's notifyOfficeOfSendBack — the
// reviewer's own note plus whatever is currently refused, straight to the
// office (OFFICE_EMAILS).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReviewState, type ReviewerRole } from '@/lib/board-review'
import { notifyOfficeOfSendBack } from '@/lib/board-review-email'
import { advanceToApprovalSent, loadDecisionContext } from '@/lib/board-decision-letter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function loadRound(token: string) {
  const { data } = await supabaseAdmin.from('document_review_rounds')
    .select('id, application_id, association_code, unit_label').eq('token', token).maybeSingle()
  if (!data) return null
  return {
    applicationId: String(data.application_id), associationCode: String(data.association_code),
    unitLabel: (data.unit_label as string | null) ?? null,
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const round = await loadRound(token)
  if (!round) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  let b: { action?: unknown; reviewer?: unknown; note?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const action = b.action === 'approve' || b.action === 'send_back' ? b.action : null
  const reviewerName = String((b.reviewer as { name?: string } | undefined)?.name ?? '').trim()
  const reviewerRole = ((b.reviewer as { role?: string } | undefined)?.role ?? 'board') as ReviewerRole
  const note = String(b.note ?? '').trim().slice(0, 4000)
  if (!action) return NextResponse.json({ error: 'action must be approve or send_back' }, { status: 400 })
  if (!reviewerName) return NextResponse.json({ error: 'Tell us who you are before deciding.' }, { status: 400 })

  if (action === 'send_back') {
    if (note.length < 4) return NextResponse.json({ error: 'Say briefly what needs to change — this goes straight to the office.' }, { status: 400 })
    await notifyOfficeOfSendBack({ applicationId: round.applicationId, reviewerName, reviewerRole, note })
    return NextResponse.json({ ok: true })
  }

  // action === 'approve'
  const state = await getReviewState(round.applicationId)
  if (!state) return NextResponse.json({ error: 'This application could not be found.' }, { status: 404 })
  if (!state.complete) return NextResponse.json({ error: 'Not everything is approved yet — decide each document first.' }, { status: 400 })

  // Some associations require a board/buyer interview before the letter goes
  // out (e.g. MANXI, purchases). Checked BEFORE the existing-letter lookup
  // below, on purpose: user feedback on the real MANXI 303 page — its letter
  // was auto-created before this requirement existed, and the interview
  // itself is still a real, unmet requirement regardless of that letter, so
  // clicking this now correctly requests the interview rather than reporting
  // "already sent" and stopping there. advanceToApprovalSent holds the
  // letter for this case (a NEW letter is never created while an interview
  // is outstanding — it returns before reaching that code at all).
  const c = await loadDecisionContext(round.applicationId)
  if (c?.interviewRequired && !c.interviewCompletedAt) {
    await advanceToApprovalSent(round.applicationId)
    return NextResponse.json({ ok: true, alreadySent: false, interviewRequested: true })
  }

  const { data: existing } = await supabaseAdmin.from('esign_documents')
    .select('id, status').eq('kind', 'board_decision').eq('association_code', round.associationCode).eq('unit_ref', round.unitLabel ?? '')
    .neq('status', 'void').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing) return NextResponse.json({ ok: true, alreadySent: true, letterStatus: existing.status })

  await advanceToApprovalSent(round.applicationId)
  return NextResponse.json({ ok: true, alreadySent: false })
}
