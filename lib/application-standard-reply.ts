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
import { sendEsignFormsForItems, ESIGN_CHECKLIST_ITEMS, type SentForm } from '@/lib/application-esign-forms'
import { splitEmails } from '@/lib/document-request-email'
import { providedByOkForRole } from '@/lib/intake-documents'
import { logOutboundCommunication } from '@/lib/application-comm-log'
import { getOutstandingSummary } from '@/lib/application-outstanding-summary'
import { sendLeasePacket, findUnitLeasePacket } from '@/lib/lease-packet'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export interface StandardReplyResult {
  applicationId: string
  /** Who the reply addresses this as — decides which document_requests slot
   *  (owner_token vs tenant_token) the upload link lives on. */
  recipientRole: 'owner' | 'tenant'
  /** null when there is nothing to put on a link at all — e.g. everything
   *  outstanding is a form MAIA already sent directly. Non-null whenever
   *  there's something to upload OR a pending vehicle/animal question — both
   *  live as real controls on this SAME link, never asked inline by email
   *  reply. User direction, 2026-08-18: "why is he replying to the questions
   *  by email? Why the card link don't make these questions and save in
   *  Maia?" */
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

interface StakeholderRow {
  name:      string | null
  email:     string | null
  phone:     string | null
  role:      string
  isPrimary: boolean
}

async function loadStakeholders(applicationId: string): Promise<StakeholderRow[]> {
  const { data } = await supabaseAdmin.from('application_stakeholders')
    .select('name, email, phone, role, is_primary').eq('application_id', applicationId)
  return (data ?? []).map(s => ({
    name: (s.name as string | null) ?? null, email: (s.email as string | null) ?? null,
    phone: (s.phone as string | null) ?? null, role: String(s.role), isPrimary: !!s.is_primary,
  }))
}

/** Is this email address the owner of record for the unit, or an applicant
 *  already on the roster? Decides which document_requests slot to use, and
 *  which outstanding items are addressed to THIS person vs relayed via them.
 *
 *  Checks application_stakeholders (scoped to this specific application)
 *  first — real bug, 2026-08-24 (MANXI 110, Monica Blumenfeld): the
 *  association-wide `owners` roster query below didn't match her email for
 *  that unit, so this silently fell through to the 'tenant' default and let
 *  applicant-only items (vehicle, pet, last year's approval letter) get
 *  addressed to her directly as if she were the applicant — she's the
 *  owner, relaying documents for her actual tenant, Susie Bell. Falling
 *  back to the roster, then to 'tenant', when NEITHER resolves keeps the
 *  draft available for staff to review rather than refusing outright. */
async function classifySender(associationCode: string, unit: string | null, email: string, stakeholders: StakeholderRow[]): Promise<'owner' | 'tenant'> {
  const lower = email.toLowerCase()
  const match = stakeholders.find(s => s.email?.toLowerCase() === lower)
  if (match?.role === 'owner') return 'owner'
  if (match?.role === 'applicant') return 'tenant'
  // match is undefined, or an agent role — application_stakeholders has no
  // "agent" bucket for this function's owner/tenant vocabulary, so agent
  // senders fall through to the same legacy roster check as before.
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

  const summary = await getOutstandingSummary(applicationId)
  if ('error' in summary) return summary
  const code = summary.associationCode, unit = summary.unitLabel

  // Recipient role decides which recipientRole below is computed from — and
  // it ALSO decides what this specific reply is allowed to ask this specific
  // person for. Without this a tenant's reply listed "Board Approval Letter"
  // as something owed FROM THEM — that document is provided_by 'landlord',
  // it is the BOARD's own output, not the tenant's to supply. Agent-provided
  // items are excluded from both roles: they go to a third party this
  // function does not address, and belong in a request scoped to the agent.
  // provided_by='staff' (Background / Credit Reports) is excluded from BOTH —
  // nobody external is ever asked; staff obtains it via Tenant Evaluation or Checkr.
  const stakeholders = await loadStakeholders(applicationId)
  const recipientRole = await classifySender(code, unit, senderEmail, stakeholders)
  const providedByOk = (pb: string) => providedByOkForRole(recipientRole, pb)

  // Who's on the OTHER side of this application from whoever's emailing —
  // used both to relay items that are theirs to supply (below) and to
  // correct the forms-sent phrasing (forms always go to the applicant
  // roster regardless of who's writing in). is_primary preferred, else the
  // first stakeholder row of that role.
  const theirLabel: 'owner' | 'tenant' = recipientRole === 'owner' ? 'tenant' : 'owner'
  const theirStakeholderRole = theirLabel === 'tenant' ? 'applicant' : 'owner'
  const theirStakeholder = stakeholders.find(s => s.role === theirStakeholderRole && s.isPrimary)
                         ?? stakeholders.find(s => s.role === theirStakeholderRole)
  const theirName = theirStakeholder?.name ?? null
  const theirWho = theirName ? `your ${theirLabel}, ${theirName},` : `your ${theirLabel}`

  // ── Don't ask for a car, or an animal, before asking IF there is one ──
  // User direction: a tenant with no vehicle should never be asked for
  // registration, and a family with no animal should never be sent the pet
  // form — that's presumptuous, and the board should see the yes/no itself,
  // not just its absence. gatedBy is computed in getOutstandingSummary from
  // the CHECKLIST's own condition_key, not hardcoded, so a future association
  // with a differently-gated item is covered for free.
  const uploadRows = summary.rows.filter(r => !r.isEsignItem && providedByOk(r.providedBy) && !r.gatedBy && r.docKey !== 'landlord_tenant_agreement')
  // Forms are unaffected by the role filter — they already always go to the
  // applicant roster regardless of who is currently emailing (sendEsignFormsForItems).
  const formRows = summary.rows.filter(r => r.isEsignItem && !r.gatedBy)
  // Real bug, 2026-08-24 (MANXI 110, Monica Blumenfeld): a vehicle/animal
  // question isn't the emailer's to answer just because they're the one
  // writing in — it's about who OCCUPIES the unit, i.e. whichever role the
  // document it gates actually belongs to (car_registration/pet_registration
  // are provided_by='applicant' — the tenant's). The old code stamped every
  // decline question with recipientRole unconditionally, so an owner
  // relaying documents got asked "do you keep a vehicle at the unit?" about
  // a unit she doesn't live in. Falls back to recipientRole (old behavior)
  // when the gated item's provided_by is 'both'/'staff'/'agent' or missing
  // — genuinely ambiguous, not worth guessing wrong on.
  const declineQuestionRole = (q: 'vehicle' | 'animal'): 'owner' | 'tenant' => {
    const gatedRow = summary.rows.find(r => r.gatedBy === q)
    if (gatedRow?.providedBy === 'applicant') return 'tenant'
    if (gatedRow?.providedBy === 'landlord') return 'owner'
    return recipientRole
  }
  const myDeclineQuestions    = summary.declineQuestions.filter(q => declineQuestionRole(q) === recipientRole)
  const theirDeclineQuestions = summary.declineQuestions.filter(q => declineQuestionRole(q) !== recipientRole)
  // provided_by='agent' can't become an "ask THIS person to upload" row for
  // either role — it's a third party neither owner nor tenant addresses — but
  // it must not just vanish either. Real bug, 2026-08-21 (MANXI 303, Wilner
  // Florestan): his Condominium Rider was refused ("please ask your agent to
  // provide"), and because that's the ONLY outstanding item, the draft told
  // HIM "everything required... is already on file — nothing further is
  // needed" — exactly backwards. He's the one who needs to know to chase his
  // agent; excluding the item from what he's asked to DO is right, excluding
  // it from what he's TOLD was the bug.
  const agentRows = summary.rows.filter(r => !r.isEsignItem && r.providedBy === 'agent' && !r.gatedBy)
  // Items that belong to the OTHER human party on this application — e.g.
  // an owner emailing in while applicant-only items (vehicle, pet, last
  // year's approval letter) are still outstanding. Same "don't just vanish"
  // reasoning as agentRows above, generalized: these get relayed through
  // the SAME link (below) rather than silently dropped or wrongly asked of
  // the sender directly. 'both' items are already covered by uploadRows —
  // providedByOk accepts 'both' for either role — so this is exactly the
  // complement: applicant-only when the sender is the owner, landlord-only
  // when the sender is the applicant.
  const theirRows = summary.rows.filter(r =>
    !r.isEsignItem && !r.gatedBy && (r.providedBy === 'applicant' || r.providedBy === 'landlord') && !providedByOk(r.providedBy) && r.docKey !== 'landlord_tenant_agreement'
  )

  // The Landlord–Tenant Agreement is not a document either party uploads — it's
  // its own e-signed packet, owner AND tenant both sign (lib/lease-packet.ts),
  // same as the staff Request panel and the lease-renewal check-in already
  // handle it (app/api/admin/pre-apply/[id]/request-docs/route.ts,
  // lib/lease-renewal-check.ts). Before this it fell into uploadRows/theirRows
  // like any other document and this reply told whoever emailed in to "visit
  // the secure link below to upload" it — a file that doesn't exist for
  // anyone to provide. Real case, 2026-09-01 (Querline Lazard). Not filtered
  // by providedByOk — both roles need to be told about it regardless of who's
  // emailing in, unlike a plain upload which only ever addresses one side.
  const packetRows = summary.rows.filter(r => r.docKey === 'landlord_tenant_agreement')

  if (uploadRows.length === 0 && formRows.length === 0 && summary.declineQuestions.length === 0 && agentRows.length === 0 && theirRows.length === 0 && packetRows.length === 0) {
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

  // ── Upload items + decline questions → ONE document_requests row, link
  // only, NO email from here ──
  //
  // One row per doc_key, not per applicant — /api/request/[token]/upload
  // always files a per-applicant item to the PRIMARY applicant, it has no way
  // to route "this one is specifically Kimberly's". Matching the admin Request
  // panel's own granularity here rather than asking through a link that can't
  // actually deliver the finer distinction the email text describes.
  //
  // The vehicle/animal questions are appended as SYNTHETIC items on this same
  // row (doc_key '__declare_vehicle__' / '__declare_animal__') so the sender
  // answers them as real Yes/No controls on /request/[token], the same page
  // they're already uploading to — not by replying to this email in prose
  // for a human to read and transcribe. See
  // app/api/request/[token]/declare/route.ts, which resolves these doc_keys
  // and writes straight into listing_applications.declarations.
  const DECLARE_ITEM: Record<'vehicle' | 'animal', { doc_key: string; label: string }> = {
    vehicle: { doc_key: '__declare_vehicle__', label: 'Do you keep a vehicle at the unit?' },
    animal: { doc_key: '__declare_animal__', label: 'Do you have a pet, service animal, or emotional support animal in the unit?' },
  }
  let uploadLink: string | null = null
  const uploadDocKeys = [...new Set(uploadRows.map(r => r.docKey))]
  // theirRows ride on the SAME link/token as uploadRows — one link the
  // sender can use themselves and/or forward, matching how staff actually
  // handle this case rather than issuing a second link nobody asked for.
  const theirDocKeys = [...new Set(theirRows.map(r => r.docKey))]
  const hasMine = uploadDocKeys.length > 0 || myDeclineQuestions.length > 0
  const hasTheirs = theirDocKeys.length > 0 || theirDeclineQuestions.length > 0
  if (uploadDocKeys.length || theirDocKeys.length || summary.declineQuestions.length) {
    const items = [
      ...uploadDocKeys.map(k => {
        const row = uploadRows.find(r => r.docKey === k)!
        return { doc_key: k, label: row.label, recipient: recipientRole }
      }),
      ...theirDocKeys.map(k => {
        const row = theirRows.find(r => r.docKey === k)!
        return { doc_key: k, label: row.label, recipient: theirLabel }
      }),
      ...myDeclineQuestions.map(q => ({ ...DECLARE_ITEM[q], recipient: recipientRole })),
      ...theirDeclineQuestions.map(q => ({ ...DECLARE_ITEM[q], recipient: theirLabel })),
    ]
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

  // ── Packet item (Landlord–Tenant Agreement) → sent immediately too, same
  // idempotent guard request-docs/route.ts already relies on: check for an
  // existing packet first so a second reply on the same thread doesn't
  // double-invite. tenantOverride mirrors that route's own reasoning — a
  // brand-new lease's tenant is often on application_stakeholders well
  // before unit_tenant_contacts has ever heard of them, and the CURRENT
  // application's own lease_start/lease_end (not unit_tenant_contacts',
  // which only refreshes on approval — real bug, MANXI 706) is the correct
  // term to file the packet under. ──
  const primaryApplicant = stakeholders.find(s => s.role === 'applicant' && s.isPrimary) ?? stakeholders.find(s => s.role === 'applicant')
  const existingPacket = packetRows.length && unit ? await findUnitLeasePacket(code, unit) : null
  let packetLeaseDates: { lease_start: string | null; lease_end: string | null } | null = null
  if (packetRows.length && unit && !existingPacket) {
    const { data } = await supabaseAdmin.from('listing_applications').select('lease_start, lease_end').eq('id', applicationId).maybeSingle()
    packetLeaseDates = (data as { lease_start: string | null; lease_end: string | null } | null) ?? null
  }
  const packet = packetRows.length && unit && !existingPacket
    ? await sendLeasePacket(code, unit, createdBy, {
        name: primaryApplicant?.name ?? null,
        email: primaryApplicant?.email ?? null,
        phone: primaryApplicant?.phone ?? null,
        leaseStart: packetLeaseDates?.lease_start ?? null,
        leaseEnd: packetLeaseDates?.lease_end ?? null,
      })
    : null
  const packetWarning = packet && !packet.ok ? [`Landlord–Tenant Agreement was not sent — ${packet.error}.`]
    : packet && packet.skipped.length ? packet.skipped.map(s => `Landlord–Tenant Agreement: ${s}.`)
    : []

  // "Still needed" is worded for the RECIPIENT — the role filter above already
  // dropped anything not theirs to provide; a form that failed to send stays
  // listed here too (it is still genuinely outstanding), just with the reason
  // surfaced separately below rather than silently disappearing. Declaration-
  // gated items are NOT in this list at all — they're a question, not a request.
  const missingSummary = [...uploadRows, ...theirRows, ...formRows, ...agentRows, ...packetRows].map(r => r.label)

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
    // hasMine/hasTheirs split the same link's items by whose responsibility
    // they are — the sender's own, vs the other party's (relayed). Each
    // decline question is attributed via declineQuestionRole (above) to
    // whichever role its gated document actually belongs to, not just
    // stamped with whoever's emailing — real bug, 2026-08-24 (MANXI 110):
    // an owner relaying documents was asked "do you keep a vehicle at the
    // unit?" about a unit she doesn't live in, because the old code had
    // only one phrasing — "please visit YOUR secure link" — addressed to
    // the owner as if every outstanding item were hers.
    lines.push('')
    if (hasMine) {
      // Wording depends on what's actually on the link — don't say "upload
      // the following" when it's only a yes/no question, and don't say "a
      // couple of quick questions" when it's only files.
      if (uploadDocKeys.length && myDeclineQuestions.length) {
        lines.push('Please visit your secure link to upload the following and answer a couple of quick questions, so everything is correctly filed on your application:')
      } else if (uploadDocKeys.length) {
        lines.push('Please upload the following through your secure link, so everything is correctly filed on your application:')
      } else {
        lines.push('We also have a couple of quick questions for you — please answer them through your secure link:')
      }
      lines.push(uploadLink)
      for (const m of uploadRows.map(r => r.label)) lines.push(`  • ${m}`)
      for (const q of myDeclineQuestions) lines.push(`  • ${DECLARE_ITEM[q].label}`)
    }

    if (hasTheirs) {
      if (hasMine) lines.push('')
      const action = theirDocKeys.length && theirDeclineQuestions.length
        ? 'upload the following and answer a few questions'
        : theirDocKeys.length ? 'upload the following' : 'answer a few questions'
      lines.push(`Please ask ${theirWho} to ${hasMine ? 'use the same link above to' : 'visit the secure link below to'} ${action}, so everything is correctly filed on the application:`)
      if (!hasMine) lines.push(uploadLink)
      for (const m of theirRows.map(r => r.label)) lines.push(`  • ${m}`)
      for (const q of theirDeclineQuestions) lines.push(`  • ${DECLARE_ITEM[q].label}`)
    }
  }

  if (forms.sent.length) {
    lines.push('')
    if (recipientRole === 'owner') {
      // Real bug, 2026-08-24 (MANXI 110): forms always go to the applicant
      // roster regardless of who's emailing (sendEsignFormsForItems, below)
      // — telling an owner-sender to "look in your inbox" pointed her at
      // links that were never sent to her.
      lines.push(`We've also sent separate links directly to ${theirName ? `${theirName}'s` : "your tenant's"} email to complete and sign — please have them check their inbox for:`)
    } else {
      lines.push('We\'ve also sent separate links to your email to complete and sign — look for these in your inbox:')
    }
    for (const f of forms.sent) lines.push(`  • ${ESIGN_CHECKLIST_ITEMS[f.docKey]?.noun ?? f.docKey}`)
  }

  if (packetRows.length) {
    lines.push('')
    if (packet?.ok) {
      lines.push('The Landlord–Tenant Agreement is a separate e-sign packet, not an upload — we\'ve just sent signing links directly to the owner and tenant by email. Please check your inbox to review and sign; there\'s nothing to attach for this one.')
    } else if (existingPacket) {
      lines.push('The Landlord–Tenant Agreement is a separate e-sign packet, not an upload — signing links were already sent by email. Please check your inbox (and your ' + theirLabel + '\'s) and sign if you haven\'t yet; there\'s nothing to attach for this one.')
    } else {
      lines.push('The Landlord–Tenant Agreement still needs to be e-signed — it is not an upload, we\'ll follow up separately with the signing link.')
    }
  }

  // provided_by='agent' items: told, not asked — there's no link to give
  // THIS recipient for something only their agent can supply, but they still
  // need to know it's still outstanding and whose court it's in.
  if (agentRows.length) {
    lines.push('')
    lines.push('Your agent still needs to provide the following — please follow up with them directly:')
    for (const r of agentRows) lines.push(`  • ${r.label}${r.refusedReason ? ` — ${r.refusedReason}` : ''}`)
  }

  // Staff-only note: NOT sent to the resident. This is what stops a failed
  // form-send from vanishing silently — the previous version listed the item
  // as "still needed" with zero indication anything had gone wrong sending it.
  if (forms.failed.length || packetWarning.length) {
    lines.push('')
    lines.push('—')
    lines.push('[Staff note — remove before sending] Could not send automatically:')
    for (const f of forms.failed) lines.push(`  • ${ESIGN_CHECKLIST_ITEMS[f.docKey]?.noun ?? f.docKey} — ${f.reason}`)
    for (const w of packetWarning) lines.push(`  • ${w}`)
  }

  // Only true when there actually IS a link above — an agent-only outstanding
  // item produces no uploadLink at all, and this sentence pointing at
  // nothing was the same class of bug as the "nothing outstanding" one
  // above: technically unreachable before agentRows existed, real once it did.
  if (uploadLink) {
    lines.push('')
    // "specific to you" only reads correctly when the sender themself has
    // something on the link and nobody else does — a pure relay (theirs
    // only) means it's really specific to the person being asked to use
    // it, not "you"; a mixed link (both) is shared with whoever the sender
    // is relaying to, so "specific to you" alone would undercut the "ask
    // them to use the same link" instruction just given above.
    lines.push(
      hasMine && hasTheirs ? 'No account or password is needed — the link above is specific to this application, so it\'s fine to share.' :
      hasMine ? 'No account or password is needed — the link above is specific to you.' :
      'No account or password is needed to use the link.'
    )
  }
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
    applicationId, recipientRole, uploadLink, uploadItems: uploadRows.map(r => r.label),
    formsSent: forms.sent, formsFailed: forms.failed, missingSummary, declineQuestions: summary.declineQuestions, nothingOutstanding: false,
    draftText,
  }
}
