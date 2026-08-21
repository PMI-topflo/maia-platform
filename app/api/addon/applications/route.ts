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
import { isEsignItem, ESIGN_CHECKLIST_ITEMS } from '@/lib/application-esign-forms'

export const dynamic = 'force-dynamic'

async function loadSummary(applicationId: string) {
  const [{ data: app }, state, { data: comms }] = await Promise.all([
    supabaseAdmin.from('listing_applications')
      .select('id, association_code, unit_label, application_type, status')
      .eq('id', applicationId).maybeSingle(),
    getReviewState(applicationId),
    // Prior requests + filed correspondence, right in the sidebar — user
    // direction, 2026-08-19: "I want all previous request and
    // communications in a list under like a box HISTORY." Same table both
    // logOutboundCommunication (drafted requests) and
    // logApplicationCommunication (forwarded/filed email) write to. Not the
    // full multi-source timeline the admin page's Communication History
    // shows (document decisions, signed approval letters) — that stays a
    // click away via the application link already in this card.
    supabaseAdmin.from('application_communications')
      .select('direction, subject, occurred_at, to_emails')
      .eq('application_id', applicationId).order('occurred_at', { ascending: false }).limit(6),
  ])
  if (!app || !state) return null

  const { data: sh } = await supabaseAdmin.from('application_stakeholders')
    .select('name').eq('application_id', applicationId).eq('role', 'applicant')
    .order('is_primary', { ascending: false })
  const applicants = (sh ?? []).map(s => String(s.name ?? '').trim()).filter(Boolean)

  const req = state.rows.filter(r => r.required)

  // Per-signer status for whichever form-backed items have ALREADY been sent
  // — "staff visibility per person" (user direction, 2026-08-18): a flat
  // "waiting" tells staff nothing about a form that has gone out to two
  // people where one signed and one is blocked. Only fetched for kinds with
  // a document actually in flight, not for items still fully unsent.
  const unit = (app.unit_label as string | null) ?? null
  const inFlightKeys = [...new Set(state.rows.filter(r => isEsignItem(r.docKey) && r.state !== 'waiting').map(r => r.docKey))]
  const inFlight: { docKey: string; noun: string; status: string; signers: { name: string | null; email: string | null; signed: boolean }[] }[] = []
  if (unit && inFlightKeys.length) {
    const kinds = inFlightKeys.map(k => ESIGN_CHECKLIST_ITEMS[k]?.kind).filter((k): k is string => !!k)
    const { data: docs } = await supabaseAdmin.from('esign_documents')
      .select('kind, status, signers, created_at').eq('association_code', app.association_code).eq('unit_ref', unit)
      .in('kind', kinds).neq('status', 'void').order('created_at', { ascending: false })
    for (const docKey of inFlightKeys) {
      const kind = ESIGN_CHECKLIST_ITEMS[docKey]?.kind
      const latest = (docs ?? []).find(d => d.kind === kind)
      if (!latest) continue
      const signers = (Array.isArray(latest.signers) ? latest.signers : []) as { name?: string | null; email?: string | null; signed_at?: string }[]
      inFlight.push({
        docKey, noun: ESIGN_CHECKLIST_ITEMS[docKey]?.noun ?? docKey, status: String(latest.status),
        signers: signers.map(sg => ({ name: sg.name ?? null, email: sg.email ?? null, signed: !!sg.signed_at })),
      })
    }
  }

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
    inFlight,
    complete: state.complete,
    dueAt: state.dueAt,
    history: (comms ?? []).map(c => ({
      direction: c.direction as string, subject: (c.subject as string | null) ?? '(no subject)',
      occurredAt: c.occurred_at as string, toEmails: (c.to_emails as string[] | null) ?? [],
    })),
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
    // ANY stakeholder role, not just 'applicant' — an agent or owner emailing
    // about an application they're on is exactly what this lookup should
    // catch. Found live, 2026-08-19: Jay Lin (role 'listing_agent') on a real
    // open lease-renewal application, sender email on file and everything,
    // never matched because this used to require role='applicant' — the
    // sidebar silently showed nothing instead of the application section.
    const { data: sh } = await supabaseAdmin.from('application_stakeholders')
      .select('application_id').ilike('email', email).limit(30)
    const ids = [...new Set((sh ?? []).map(r => String(r.application_id)))]
    if (ids.length) {
      const { data: apps } = await supabaseAdmin.from('listing_applications')
        .select('id, status, created_at').in('id', ids).order('created_at', { ascending: false })
      // An open application is a stronger match than a decided one — a
      // renter emailing about "my application" almost never means one from
      // two associations ago that's already approved.
      applicationId = (apps ?? []).find(a => ['started', 'submitted', 'under_review', 'approval_sent'].includes(String(a.status)))?.id as string | undefined
        ?? (apps ?? [])[0]?.id as string | undefined ?? null
    }
  }

  // Owner fallback — an owner forwarding a tenant's documents is a stakeholder
  // lookup miss just as often as a match: the person is known to MAIA via the
  // `owners` table (synced from CINC) but was never explicitly ADDED as an
  // `application_stakeholders` row on this particular application. Found live,
  // 2026-08-20: MANXI 912's owner (Carmen Robinson, jk.robin17@gmail.com)
  // emailed in about the unit's lease application and the sidebar showed
  // nothing — she was never a stakeholder row, only ever in `owners`. Resolve
  // by email -> unit -> an open application on that unit, same precedence as
  // the stakeholder path above (open beats decided).
  if (!applicationId && email) {
    const { data: ownerRows } = await supabaseAdmin.from('owners')
      .select('association_code, unit_number, account_number')
      .ilike('emails', `%${email}%`).or('status.neq.previous,status.is.null').limit(10)
    for (const o of (ownerRows ?? [])) {
      const code = String(o.association_code ?? '')
      const unit = String(o.unit_number ?? '')
      if (!code || !unit) continue
      const { data: apps } = await supabaseAdmin.from('listing_applications')
        .select('id, status, created_at').eq('association_code', code).eq('unit_label', unit)
        .order('created_at', { ascending: false })
      const hit = (apps ?? []).find(a => ['started', 'submitted', 'under_review', 'approval_sent'].includes(String(a.status)))
        ?? (apps ?? [])[0]
      if (hit) { applicationId = String(hit.id); break }
    }
  }

  if (!applicationId) return NextResponse.json({ matched: null })

  const summary = await loadSummary(applicationId)
  return NextResponse.json({ matched: summary })
}
