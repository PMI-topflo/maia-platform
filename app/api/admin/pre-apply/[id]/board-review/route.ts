// GET  /api/admin/pre-apply/[id]/board-review → who'd receive it, the state, blockers
// POST /api/admin/pre-apply/[id]/board-review → start a round + email the approvers
//
// Staff (or the manager) start the per-document review. The board and the
// on-site manager get ONE link; any one of them settles a document. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getReviewState, boardWindowSentence, REVIEW_REMINDER_DAYS, type ReviewerRole } from '@/lib/board-review'
import { sendReviewRound, OFFICE_EMAILS } from '@/lib/board-review-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

/** The people who may decide: active board members + the association's on-site
 *  manager. Staff pick from these rather than typing addresses, so a decision
 *  is always attributable to a named approver. */
async function approversFor(code: string): Promise<{ name: string; email: string; role: ReviewerRole }[]> {
  // Both tables store first_name/last_name, not a single name column.
  const [{ data: board }, { data: mgrs }] = await Promise.all([
    supabaseAdmin.from('board_members').select('first_name, last_name, email, position, active').eq('association_code', code),
    supabaseAdmin.from('building_managers').select('first_name, last_name, email, active').eq('association_code', code),
  ])
  const full = (a: unknown, b: unknown) => `${String(a ?? '').trim()} ${String(b ?? '').trim()}`.trim()
  const out: { name: string; email: string; role: ReviewerRole }[] = []
  for (const b of board ?? []) {
    if (b.active === false) continue
    const email = String(b.email ?? '').trim()
    const name = full(b.first_name, b.last_name)
    if (email.includes('@') && name) out.push({ name: b.position ? `${name} (${b.position})` : name, email, role: 'board' })
  }
  for (const m of mgrs ?? []) {
    if (m.active === false) continue
    const email = String(m.email ?? '').trim()
    const name = full(m.first_name, m.last_name)
    if (email.includes('@') && name) out.push({ name, email, role: 'onsite_manager' })
  }
  // Dedupe by address — one person wearing two hats gets one email.
  const seen = new Set<string>()
  return out.filter(p => !seen.has(p.email.toLowerCase()) && seen.add(p.email.toLowerCase()))
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('association_code').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [state, approvers, { data: rounds }] = await Promise.all([
    getReviewState(id),
    approversFor(String(app.association_code)),
    supabaseAdmin.from('document_review_rounds').select('id, token, created_at, recipients, reminder_count, last_reminder_at')
      .eq('application_id', id).order('created_at', { ascending: false }),
  ])
  if (!state) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const blockers: string[] = []
  if (!approvers.length) blockers.push('No board members or on-site manager with an email on file for this association.')
  if (state.totals.received === 0) blockers.push('Nothing has been uploaded yet — there is nothing for the board to review.')

  return NextResponse.json({
    approvers, blockers,
    officeNotified: OFFICE_EMAILS,
    reminderDays: REVIEW_REMINDER_DAYS,
    windowSentence: boardWindowSentence(state.windowDays),
    rounds: (rounds ?? []).map(r => ({
      id: String(r.id), createdAt: r.created_at, reminderCount: r.reminder_count, lastReminderAt: r.last_reminder_at,
      link: `${APP}/board-review/${r.token}`,
      recipients: (Array.isArray(r.recipients) ? r.recipients : []) as { name?: string; email?: string }[],
    })),
    ...state,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let b: { emails?: unknown; note?: unknown } = {}
  try { b = await req.json() } catch { /* optional */ }

  const code = String(app.association_code)
  const all = await approversFor(code)
  const picked = Array.isArray(b.emails) && b.emails.length
    ? all.filter(a => (b.emails as unknown[]).map(e => String(e).toLowerCase()).includes(a.email.toLowerCase()))
    : all
  if (!picked.length) return NextResponse.json({ error: 'No approver with an email on file — add the board members or the on-site manager first.' }, { status: 400 })

  const state = await getReviewState(id)
  if (!state || state.totals.received === 0) {
    return NextResponse.json({ error: 'Nothing has been uploaded yet — there is nothing for the board to review.' }, { status: 400 })
  }

  const { data: round, error } = await supabaseAdmin.from('document_review_rounds').insert({
    application_id: id, association_code: code, unit_label: (app.unit_label as string | null) ?? null,
    token: crypto.randomUUID(), recipients: picked, note: String(b.note ?? '').trim() || null,
    started_by: `staff:${session.displayName}`, purpose: 'document_review',
  }).select('id, token').single()
  if (error || !round) return NextResponse.json({ error: `Could not start the review: ${error?.message ?? 'unknown'}` }, { status: 500 })

  const { sent, to } = await sendReviewRound(String(round.id))
  return NextResponse.json({
    ok: true, sent, to,
    link: `${APP}/board-review/${round.token}`,
    ...(sent ? {} : { error: 'The review was created but the email could not be sent — copy the link and send it by hand.' }),
  })
}
