// GET /api/addon/applications?gmailThreadId=…&email=…
//
// The Gmail add-on calls this when an email is open, to show the matched
// application's LIVE checklist state in the sidebar — same shape as
// /api/addon/context for tickets, but for the applications pipeline.
//
// "Live" is the whole point: this reads getReviewState() fresh on every call,
// the same function the staff screen and the board-review link read. There is
// no cached snapshot anywhere in this path — an answer given from Gmail must
// never be able to disagree with the answer given on /admin/pre-apply/[id].
//
// Matching, cheapest and most reliable first:
//   1. Gmail thread — application_communications already records
//      gmail_thread_id whenever a message was logged with @maia upapp.
//   2. Contact email — the sender is an applicant on some application,
//      preferring one still open over one already decided.
//
// Auth: add-on bearer token (lib/addon-token.ts). Not session-gated.

import { NextResponse } from 'next/server'
import { addonStaffEmail } from '@/lib/addon-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReviewState } from '@/lib/board-review'
import { isEsignItem } from '@/lib/application-esign-forms'

export const dynamic = 'force-dynamic'

async function loadSummary(applicationId: string) {
  const [{ data: app }, state] = await Promise.all([
    supabaseAdmin.from('listing_applications')
      .select('id, association_code, unit_label, application_type, status')
      .eq('id', applicationId).maybeSingle(),
    getReviewState(applicationId),
  ])
  if (!app || !state) return null

  const { data: sh } = await supabaseAdmin.from('application_stakeholders')
    .select('name').eq('application_id', applicationId).eq('role', 'applicant')
    .order('is_primary', { ascending: false })
  const applicants = (sh ?? []).map(s => String(s.name ?? '').trim()).filter(Boolean)

  const req = state.rows.filter(r => r.required)
  return {
    id: applicationId,
    associationCode: app.association_code, unitLabel: app.unit_label,
    applicationType: app.application_type, status: app.status,
    applicants,
    totals: state.totals,
    // Named, not just counted — this is the part a static PDF snapshot can
    // never give you, because by the time someone opens the PDF it may
    // already be wrong.
    missing: req.filter(r => r.state === 'waiting').map(r => r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label),
    refused: req.filter(r => r.state === 'refused').map(r => ({ label: r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label, reason: r.decision?.reason ?? null })),
    // Which of the FORM items (Rules Ack / Pet Registration / Emergency
    // Contact) are still outstanding — these are the one-click "send" buttons
    // the add-on offers. Deliberately over ALL rows, not just `req`: Pet
    // Registration is OPTIONAL on most checklists, but "the applicant claims
    // it's already handled and it plainly isn't" is exactly the case this
    // button exists for — restricting it to required items would have hidden
    // it in precisely the situation that motivated building this.
    sendable: state.rows.filter(r => isEsignItem(r.docKey) && r.state === 'waiting').map(r => r.docKey),
    complete: state.complete,
    dueAt: state.dueAt,
  }
}

export async function GET(req: Request) {
  const staff = await addonStaffEmail(req)
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const thread = (url.searchParams.get('gmailThreadId') ?? '').trim() || null
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase() || null

  let applicationId: string | null = null

  if (thread) {
    const { data } = await supabaseAdmin.from('application_communications')
      .select('application_id').eq('gmail_thread_id', thread)
      .order('occurred_at', { ascending: false }).limit(1).maybeSingle()
    applicationId = (data?.application_id as string | null) ?? null
  }

  if (!applicationId && email) {
    const { data: sh } = await supabaseAdmin.from('application_stakeholders')
      .select('application_id').eq('role', 'applicant').ilike('email', email).limit(30)
    const ids = [...new Set((sh ?? []).map(r => String(r.application_id)))]
    if (ids.length) {
      const { data: apps } = await supabaseAdmin.from('listing_applications')
        .select('id, status, created_at').in('id', ids).order('created_at', { ascending: false })
      // An open application is a stronger match than a decided one — a
      // renter emailing about "my application" almost never means one from
      // two associations ago that's already approved.
      applicationId = (apps ?? []).find(a => ['started', 'submitted', 'under_review'].includes(String(a.status)))?.id as string | undefined
        ?? (apps ?? [])[0]?.id as string | undefined ?? null
    }
  }

  if (!applicationId) return NextResponse.json({ matched: null })

  const summary = await loadSummary(applicationId)
  return NextResponse.json({ matched: summary })
}
