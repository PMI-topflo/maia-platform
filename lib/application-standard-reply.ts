// =====================================================================
// lib/application-standard-reply.ts
//
// The standard reply to an owner or tenant who emails documents: thank them,
// then send them to the self-serve upload link instead of staff filing the
// attachment by hand. User direction, 2026-08-18: "I want them to upload in
// the system and not uploading by myself... send the email always like this
// with the list of missing info or documents, that way we can build in the
// future an agent to reply automatically."
//
// Two things fall out of that:
//   1. The reply is the SAME SHAPE every time — thank-you, link, missing
//      list, nothing hand-composed — because a reply a human customizes
//      case-by-case is exactly what an agent cannot take over later. This is
//      deliberately the most mechanical writing in the whole codebase.
//   2. It is a DRAFT, not a send. A human still reviews it before it goes —
//      "in the future an agent replies automatically" is stated as a later
//      step, not this one. See gmail-addon/Code.gs → onComposeInsertDraft.
//
// UPLOAD items reuse the exact document_requests row the admin Request panel
// creates (app/api/admin/pre-apply/[id]/request-docs/route.ts) — same table,
// same token, same /request/[token] page — but does NOT call
// sendDocumentRequestEmails, because the reply this builds IS the email; a
// second automated one would duplicate it.
//
// FORM items (Rules Ack / Pet Registration / Emergency Contact) still send
// immediately through sendEsignFormsForItems, unchanged from v1 — those were
// never a "let me draft this" decision, they're mechanical already.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReviewState } from '@/lib/board-review'
import { isEsignItem, sendEsignFormsForItems, ESIGN_CHECKLIST_ITEMS, type SentForm } from '@/lib/application-esign-forms'
import { splitEmails } from '@/lib/document-request-email'
import { getIntakeChecklist, isApplicationType, parseDeclarations, pendingDeclarations } from '@/lib/intake-documents'
import { logOutboundCommunication } from '@/lib/application-comm-log'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export interface StandardReplyResult {
  applicationId: string
  /** Who the reply addresses this as — decides which document_requests slot
   *  (owner_token vs tenant_token) the upload link lives on. */
  recipientRole: 'owner' | 'tenant'
  /** null when nothing needs uploading — e.g. everything outstanding is a
   *  form MAIA already sent directly. */
  uploadLink: string | null
  uploadItems: string[]
  formsSent: SentForm[]
  formsFailed: { docKey: string; reason: string }[]
  /** Everything still outstanding, worded for a resident to read. */
  missingSummary: string[]
  /** Vehicle/animal — asked as a yes/no BEFORE requesting the related
   *  document, rather than presuming one exists. Empty once declarations.vehicle
   *  / declarations.animal have both been answered for this application. */
  declineQuestions: ('vehicle' | 'animal')[]
  /** Ready to insert into the Gmail reply compose box as-is. */
  draftText: string
  nothingOutstanding: boolean
}

/** Is this email address the owner of record for the unit, or an applicant
 *  already on the roster? Decides which document_requests slot to use. Falls
 *  back to 'tenant' when it matches neither — an applicant reaching out
 *  about their own missing documents is the overwhelmingly common case, and
 *  defaulting there (rather than refusing) keeps the draft available; staff
 *  reviewing it before send is the actual safety net, not this guess. */
async function classifySender(associationCode: string, unit: string | null, email: string): Promise<'owner' | 'tenant'> {
  if (unit) {
    const { data: owners } = await supabaseAdmin.from('owners')
      .select('emails').eq('association_code', associationCode)
      .or(`unit_number.eq.${unit},account_number.eq.${associationCode}${unit}`)
    const isOwner = (owners ?? []).some(o => splitEmails(o.emails).some(e => e.toLowerCase() === email.toLowerCase()))
    if (isOwner) return 'owner'
  }
  return 'tenant'
}

export async function draftStandardReply(opts: {
  applicationId: string
  senderEmail: string
  senderName: string | null
  createdBy: string
}): Promise<StandardReplyResult | { error: string }> {
  const { applicationId, senderEmail, senderName, createdBy } = opts

  const [{ data: app }, state] = await Promise.all([
    supabaseAdmin.from('listing_applications').select('id, association_code, unit_label, application_type, declarations').eq('id', applicationId).maybeSingle(),
    getReviewState(applicationId),
  ])
  if (!app || !state) return { error: 'application not found' }
  const code = String(app.association_code), unit = (app.unit_label as string | null) ?? null

  // Deliberately over ALL rows, not just required ones — the pet-registration
  // lesson from this same week: an optional item the sender claims is "already
  // handled" and plainly isn't is exactly what this reply exists to catch.
  const outstanding = state.rows.filter(r => r.state === 'waiting' || r.state === 'refused')
  const label = (r: (typeof outstanding)[number]) => r.perApplicantName ? `${r.label} — ${r.perApplicantName}` : r.label

  // Recipient role decides which recipientRole below is computed from — and
  // it ALSO decides what this specific reply is allowed to ask this specific
  // person for. Without this a tenant's reply listed "Board Approval Letter"
  // as something owed FROM THEM — that document is provided_by 'landlord',
  // it is the BOARD's own output, not the tenant's to supply. Agent-provided
  // items are excluded from both roles: they go to a third party this
  // function does not address, and belong in a request scoped to the agent.
  // provided_by='staff' (Background / Credit Reports) is excluded from BOTH —
  // nobody external is ever asked; staff obtains it via Tenant Evaluation or Checkr.
  const recipientRole = await classifySender(code, unit, senderEmail)
  const providedByOk = (pb: string) => recipientRole === 'owner' ? (pb === 'landlord' || pb === 'both') : (pb === 'applicant' || pb === 'both')

  // ── Don't ask for a car, or an animal, before asking IF there is one ──
  // User direction: a tenant with no vehicle should never be asked for
  // registration, and a family with no animal should never be sent the pet
  // form — that's presumptuous, and the board should see the yes/no itself,
  // not just its absence. The gate (declarations.vehicle / declarations.animal)
  // already existed for the /apply flow; this is the first thing that also
  // asks it on applications that were staff-created and never went through
  // that flow. docKeyCondition is read from the CHECKLIST, not hardcoded, so
  // a future association with a differently-gated item is covered for free.
  const type = String(app.application_type ?? '')
  const checklist = isApplicationType(type) ? await getIntakeChecklist(code, type) : []
  const declarations = parseDeclarations(app.declarations)
  const pending = pendingDeclarations(checklist, declarations)
  const docKeyCondition = new Map(checklist.map(c => [c.doc_key, c.condition_key]))
  const gatedUnanswered = (docKey: string): 'vehicle' | 'animal' | null => {
    const ck = docKeyCondition.get(docKey)
    if (ck === 'vehicle' && pending.includes('vehicle')) return 'vehicle'
    if ((ck === 'pet' || ck === 'assistance_animal') && pending.includes('animal')) return 'animal'
    return null
  }

  const uploadRows = outstanding.filter(r => !isEsignItem(r.docKey) && providedByOk(r.providedBy) && !gatedUnanswered(r.docKey))
  // Forms are unaffected by the role filter — they already always go to the
  // applicant roster regardless of who is currently emailing (sendEsignFormsForItems).
  const formRows = outstanding.filter(r => isEsignItem(r.docKey) && !gatedUnanswered(r.docKey))
  // What to ASK ABOUT, not request — named once each even if multiple doc_keys
  // share the same gate (car_registration alone triggers 'vehicle'; pet_registration
  // AND assistance_animal_documentation both roll under 'animal').
  const declineQuestions: ('vehicle' | 'animal')[] = [...new Set(outstanding.map(r => gatedUnanswered(r.docKey)).filter((x): x is 'vehicle' | 'animal' => !!x))]

  if (uploadRows.length === 0 && formRows.length === 0 && declineQuestions.length === 0) {
    const draftText = `Hello${senderName ? ` ${senderName}` : ''},\n\nThank you for reaching out. Everything required on your application is already on file — nothing further is needed from you at this time.\n\nWe'll be in touch as soon as there's an update.\n\nThank you,\nPMI Top Florida Properties`
    await logOutboundCommunication({
      applicationId, associationCode: code, unitLabel: unit,
      subject: 'Reply drafted — nothing outstanding', body: draftText,
      toEmails: [senderEmail], loggedBy: createdBy,
    })
    return {
      applicationId, recipientRole, uploadLink: null, uploadItems: [], formsSent: [], formsFailed: [],
      missingSummary: [], declineQuestions: [], nothingOutstanding: true,
      draftText,
    }
  }

  // ── Upload items → a document_requests row, link only, NO email from here ──
  //
  // One row per doc_key, not per applicant — /api/request/[token]/upload
  // always files a per-applicant item to the PRIMARY applicant, it has no way
  // to route "this one is specifically Kimberly's". Matching the admin Request
  // panel's own granularity here rather than asking through a link that can't
  // actually deliver the finer distinction the email text describes.
  let uploadLink: string | null = null
  const uploadDocKeys = [...new Set(uploadRows.map(r => r.docKey))]
  if (uploadDocKeys.length) {
    const items = uploadDocKeys.map(k => {
      const row = uploadRows.find(r => r.docKey === k)!
      return { doc_key: k, label: row.label, recipient: recipientRole }
    })
    const token = crypto.randomUUID()
    const { data: created, error } = await supabaseAdmin.from('document_requests').insert({
      application_id: applicationId, association_code: code, unit_label: unit, items,
      message: null, created_by: createdBy,
      ...(recipientRole === 'owner' ? { owner_token: token, owner_email: senderEmail } : { tenant_token: token, tenant_email: senderEmail }),
    }).select('id').single()
    if (!error && created) uploadLink = `${APP}/request/${token}`
  }

  // ── Form items → sent immediately, same as v1's individual Send buttons ──
  const forms = formRows.length
    ? await sendEsignFormsForItems(applicationId, formRows.map(r => r.docKey), createdBy)
    : { sent: [], failed: [] }

  // "Still needed" is worded for the RECIPIENT — the role filter above already
  // dropped anything not theirs to provide; a form that failed to send stays
  // listed here too (it is still genuinely outstanding), just with the reason
  // surfaced separately below rather than silently disappearing. Declaration-
  // gated items are NOT in this list at all — they're a question, not a request.
  const missingSummary = [...uploadRows, ...formRows].map(label)

  const DECLARE_QUESTION: Record<'vehicle' | 'animal', string> = {
    vehicle: 'Do you keep a vehicle at the unit? Just reply yes or no — if yes, we\'ll follow up for the registration.',
    animal: 'Do you have a pet, service animal, or emotional support animal in the unit? Just reply yes or no — if yes, we\'ll send you the short form.',
  }

  // Grouped into what to DO with each part, rather than one flat list mixing
  // "upload this", "we already emailed you a separate link for that", and
  // "we couldn't ask this yet" — the earlier flat version put "Updated
  // Emergency Contact List" under "Still needed" right next to the sentence
  // announcing a separate link had JUST been sent for exactly that, with
  // nothing tying the two together.
  const lines: string[] = []
  lines.push(`Hello${senderName ? ` ${senderName}` : ''},`)
  lines.push('')
  lines.push('Thank you for sending your documents.')

  if (uploadLink) {
    lines.push('')
    lines.push('Please upload the following through your secure link, so everything is correctly filed on your application:')
    lines.push(uploadLink)
    for (const m of uploadRows.map(label)) lines.push(`  • ${m}`)
  }

  if (forms.sent.length) {
    lines.push('')
    lines.push('We\'ve also sent separate links to your email to complete and sign — look for these in your inbox:')
    for (const f of forms.sent) lines.push(`  • ${ESIGN_CHECKLIST_ITEMS[f.docKey]?.noun ?? f.docKey}`)
  }

  if (declineQuestions.length) {
    lines.push('')
    lines.push('Before we ask for anything further, a couple of quick questions:')
    for (const q of declineQuestions) lines.push(`  • ${DECLARE_QUESTION[q]}`)
  }

  // Staff-only note: NOT sent to the resident. This is what stops a failed
  // form-send from vanishing silently — the previous version listed the item
  // as "still needed" with zero indication anything had gone wrong sending it.
  if (forms.failed.length) {
    lines.push('')
    lines.push('—')
    lines.push('[Staff note — remove before sending] Could not send automatically:')
    for (const f of forms.failed) lines.push(`  • ${ESIGN_CHECKLIST_ITEMS[f.docKey]?.noun ?? f.docKey} — ${f.reason}`)
  }

  lines.push('')
  lines.push('No account or password is needed — the link above is specific to you.')
  lines.push('')
  lines.push('Thank you,')
  lines.push('PMI Top Florida Properties')

  const draftText = lines.join('\n')

  // Part of the application's own record — not just something that happened
  // in Gmail. Logged at DRAFT time: Apps Script's compose-insert has no hook
  // for "the user actually pressed Send", so this is the only point MAIA is
  // in the loop at all. Subject says "drafted", honestly, not "sent".
  await logOutboundCommunication({
    applicationId, associationCode: code, unitLabel: unit,
    subject: 'Reply drafted — ask them to upload', body: draftText,
    toEmails: [senderEmail], loggedBy: createdBy,
  })

  return {
    applicationId, recipientRole, uploadLink, uploadItems: uploadRows.map(label),
    formsSent: forms.sent, formsFailed: forms.failed, missingSummary, declineQuestions, nothingOutstanding: false,
    draftText,
  }
}
