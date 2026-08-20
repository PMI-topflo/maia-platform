// POST /api/admin/pre-apply/[id]/review-decision
//   { scopeKey, decision: 'approved'|'refused'|'clear', reason? }
//
// Staff decide a document from the application screen, using the same record
// the board writes to — one decision per document, whoever made it. That is
// why the old Actions block (Mark audited / Request more / Decline) could go:
// an application-wide verdict said nothing about WHICH document was wrong, so
// "request more" always needed a hand-typed note explaining what the buttons
// could not.
//
// 'clear' removes a decision — a staff correction, not a board override.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getReviewState, syncBoardWindow } from '@/lib/board-review'
import { notifyOfficeOfReviewResponse } from '@/lib/board-review-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { scopeKey?: unknown; decision?: unknown; reason?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const scopeKey = String(b.scopeKey ?? '').trim()
  const decision = b.decision === 'approved' || b.decision === 'refused' || b.decision === 'clear' ? b.decision : null
  const reason = String(b.reason ?? '').trim().slice(0, 2000)
  if (!scopeKey || !decision) return NextResponse.json({ error: 'scopeKey and decision are required' }, { status: 400 })

  const state = await getReviewState(id)
  const row = state?.rows.find(r => r.scopeKey === scopeKey)
  if (!row) return NextResponse.json({ error: 'That document is not on this application.' }, { status: 404 })

  if (decision === 'clear') {
    await supabaseAdmin.from('application_document_reviews').delete().eq('application_id', id).eq('scope_key', scopeKey)
    const { state: after } = await syncBoardWindow(id)
    return NextResponse.json({ ok: true, ...(after ?? {}) })
  }

  if (row.state === 'waiting') {
    return NextResponse.json({ error: `“${row.label}” has not been uploaded yet, so there is nothing to review.` }, { status: 400 })
  }
  // Same rule as the board: a refusal the applicant cannot act on is the
  // "incomplete" email that started this.
  if (decision === 'refused' && reason.length < 4) {
    return NextResponse.json({ error: 'Say briefly why it is refused — the applicant sees this and needs to know what to fix.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('application_document_reviews').upsert({
    application_id: id, doc_key: row.docKey, scope_key: scopeKey,
    decision, reason: decision === 'refused' ? reason : null,
    decided_by: session.displayName, decided_by_role: 'staff',
    decided_at: new Date().toISOString(),
  }, { onConflict: 'application_id,scope_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // submitted → under_review happens automatically inside syncBoardWindow
  // the instant every required document is individually approved (see
  // lib/board-review.ts) — shared by this route and the board's own
  // decision route, so it fires the same way whichever side completes it.
  const { opened, state: after } = await syncBoardWindow(id)

  // Staff decisions go to the office log too, so the record of who decided
  // what is one stream rather than two.
  await notifyOfficeOfReviewResponse({
    applicationId: id, roundId: '', label: row.perApplicantName ? `${row.label} — ${row.perApplicantName}` : row.label,
    decision, reason: decision === 'refused' ? reason : null,
    reviewerName: session.displayName, reviewerRole: 'staff', windowOpened: opened,
  }).catch(() => null)

  return NextResponse.json({ ok: true, windowOpened: opened, ...(after ?? {}) })
}
