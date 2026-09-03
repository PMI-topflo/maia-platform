// GET /api/pre-apply/[token]
// The intake state for whichever stakeholder holds this token: their role +
// whether they sign, the per-type document checklist (flagged with which items
// are theirs to provide and which are already uploaded), the association rules,
// and — for the lead — the list of collaborators and their progress. Token auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getIntake, resolveToken, listStakeholders, roleToProvidedBy, roleLabel, INTAKE_BUCKET } from '@/lib/preapply'
import { getIntakeChecklist, PROVIDED_BY_LABEL, parseDeclarations, pendingDeclarations } from '@/lib/intake-documents'
import { activeConditions, declaredPetWhereProhibited, ANIMAL_KIND_LABEL, ANIMAL_KIND_BLURB, animalDocGuidance } from '@/lib/animal-accommodation'
import { maskEmail, maskPhone } from '@/lib/esign-verify'
import { getOrCreateEsignLink } from '@/lib/application-esign-forms'
import { getOrCreateLeasePacketLink } from '@/lib/lease-packet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await resolveToken(token)
  if (!r) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(r.applicationId)
  if (!intake) return NextResponse.json({ error: 'This application could not be found.' }, { status: 404 })

  const me = r.stakeholder
  const [checklist, { data: assoc }, { data: rules }, collaborators, { data: appRow }] = await Promise.all([
    getIntakeChecklist(intake.associationCode, intake.type),
    supabaseAdmin.from('associations').select('association_name, legal_name, pets_allowed').eq('association_code', intake.associationCode).maybeSingle(),
    supabaseAdmin.from('association_application_rules').select('rule_key, label').eq('association_code', intake.associationCode).eq('active', true),
    listStakeholders(r.applicationId),
    supabaseAdmin.from('listing_applications').select('declarations, lease_start, lease_end').eq('id', r.applicationId).maybeSingle(),
  ])
  const uploaded = new Set(intake.docKeys)
  const myProvidedBy = roleToProvidedBy(me.role)

  // Conditional items (vehicle / pet / assistance animal) only reach the
  // applicant once they have said the thing applies to them. An unanswered
  // gate hides the item AND blocks submission, so nothing is silently skipped.
  const petsAllowed = (assoc?.pets_allowed as boolean | null) ?? null
  const declarations = parseDeclarations(appRow?.declarations)
  const liveConditions = activeConditions(declarations, { petsAllowed })
  const applies = (c: string | null) => !c || liveConditions.has(c)
  // provided_by='staff' items (e.g. Background/Credit Reports) are pulled by
  // staff from a verified third-party source (Tenant Evaluation/Checkr) — they
  // must never be shown as an uploadable slot to any self-serve party, even in
  // the "other documents, upload if you have them" convenience section. A real
  // incident (MANXI 802, 2026-08-29): an applicant uploaded an unrelated
  // person's background-check screenshot into this slot because it rendered
  // with the same interactive upload control as every other item.
  // governing_docs_ack (Rules Knowledge Acknowledgment) is captured by the
  // dedicated checkbox + typed name + SignaturePad block further down this
  // same page (POST .../submit), never by a plain file upload — showing it
  // in the checklist too let an applicant "satisfy" it by uploading an
  // unrelated file instead of actually signing (real incident, MANXI 802,
  // 2026-08-29: an insurance PDF landed there).
  // emergency_contact, military_service_disclosure, pet_registration and
  // maintenance_assessment_ack are ALSO real e-signed forms
  // (lib/application-esign-forms.ts), never a plain upload — same class of
  // bug as governing_docs_ack above, just without a dedicated inline block on
  // this page. Every one of them is configured provided_by='applicant'
  // (supabase/migrations/20260815_vehicle_animal_declarations.sql,
  // 20260828_default_intake_checklist_template.sql), so excluded outright for
  // any other role viewing this checklist (nobody signs someone else's
  // military-service disclosure, pet registration, or emergency contacts on
  // their behalf); for the applicant themselves, a real signing link is
  // attached below instead of leaving it as an uploadable slot.
  const LIVE_ESIGN_KEYS = new Set(['emergency_contact', 'military_service_disclosure', 'pet_registration', 'maintenance_assessment_ack'])
  // landlord_tenant_agreement is excluded from the generic checklist mapping
  // below for the same reason governing_docs_ack is: it's a real two-party
  // e-signed document (lib/lease-packet.ts), never a plain upload, and its
  // "mine" (provided_by='landlord') would only ever be true for the owner --
  // the tenant needs their own sign link too, which the generic per-item map
  // can't express (one provided_by, one link, per item). Given its own
  // handling below (leaseAgreement) instead, same self-service pattern as
  // the LIVE_ESIGN_KEYS items just on lease-packet's own token system.
  const visible = checklist.filter(d => {
    if (!applies(d.condition_key) || d.provided_by === 'staff' || d.doc_key === 'governing_docs_ack' || d.doc_key === 'landlord_tenant_agreement') return false
    if (LIVE_ESIGN_KEYS.has(d.doc_key) && d.provided_by !== myProvidedBy) return false
    return true
  })

  // Real gap found 2026-09-03: with no handling here at all, this fell
  // through to a plain upload box on whichever role's own checklist showed
  // it -- the same "asked to upload a document nobody could ever produce a
  // file for" bug already fixed for the staff request-docs flow (MANXI 912,
  // 2026-08-21), just never fixed in this second code path. Only the owner
  // and the tenant/applicant actually sign it -- an agent or co-applicant
  // viewing their own checklist never sees it at all, same as they'd never
  // see someone else's military-service disclosure.
  const leaseChecklistItem = checklist.find(d => d.doc_key === 'landlord_tenant_agreement' && applies(d.condition_key))
  const myLeaseRole: 'owner' | 'tenant' | null = me.role === 'owner' ? 'owner' : me.role === 'applicant' ? 'tenant' : null
  const leaseAgreement = (leaseChecklistItem && myLeaseRole)
    ? await getOrCreateLeasePacketLink(intake.associationCode, String(intake.unitLabel ?? ''), myLeaseRole, `token:pre-apply/${token}`, {
        name: intake.applicant?.name ?? null, email: intake.applicant?.email ?? null, phone: intake.applicant?.phone ?? null,
        leaseStart: (appRow?.lease_start as string | null) ?? null, leaseEnd: (appRow?.lease_end as string | null) ?? null,
      }).catch(() => null)
    : null

  // Signed download URLs for any blank forms the applicant must print & notarize.
  const templateUrls = new Map<string, string>()
  await Promise.all(checklist.filter(d => d.template_path).map(async d => {
    const { data } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUrl(String(d.template_path), 60 * 60 * 4)
    if (data?.signedUrl) templateUrls.set(d.doc_key, data.signedUrl)
  }))

  return NextResponse.json({
    associationName: (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || intake.associationCode,
    type: intake.type,
    unitLabel: intake.unitLabel,
    // Needed client-side only to build the /apply?listingApp= hand-off URL for
    // the screening-payment gate; detailedApplicationId is non-null once the
    // primary applicant has paid + consented via that hand-off.
    applicationId: intake.applicationId,
    detailedApplicationId: intake.detailedApplicationId,
    // Landlord-Tenant Agreement, owner/tenant self-service (see comment
    // above) -- null for anyone else, or once this association/type doesn't
    // require it, or once this role has already signed their side.
    leaseAgreement: leaseAgreement ? { label: leaseChecklistItem!.label, url: leaseAgreement.url } : null,
    // The current stakeholder holding this token
    me: {
      name: me.name, role: me.role, roleLabel: roleLabel(me.role), signs: me.signs,
      isPrimary: me.isPrimary, status: me.status, emailVerified: !!me.emailVerifiedAt,
      // "emailVerified" is really "identity verified", possibly over phone --
      // see markStakeholderVerified. verifyChannel tells the client which
      // channel send-otp/verify-otp will actually use (email if on file,
      // else phone -- same deterministic rule server-side), and
      // verifyTargetMasked is whichever of email/phone that resolves to, so
      // the UI can say "we texted you a code" instead of always "emailed".
      emailMasked: maskEmail(me.email), signed: !!me.signedAt,
      verifyChannel: (me.email ?? '').includes('@') ? 'email' as const : 'phone' as const,
      verifyTargetMasked: (me.email ?? '').includes('@') ? maskEmail(me.email) : maskPhone(me.phone),
      checklistAckSignedAt: me.checklistAckSignedAt,
    },
    // The lead always can; so can the owner — they didn't start the
    // application but still need a way to add their own agent (Rule 2).
    canAddCollaborators: me.isPrimary || me.role === 'owner',
    submitted: !!intake.submittedAt,
    providerLabels: PROVIDED_BY_LABEL,
    // Every checklist item, flagged "mine" (this stakeholder provides it) + uploaded
    checklist: await Promise.all(visible.map(async d => {
      const mine = d.provided_by === myProvidedBy
      const alreadyDone = uploaded.has(d.doc_key)
      // Mint (or reuse) the real signing link right here rather than leaving
      // this as an uploadable slot — see the LIVE_ESIGN_KEYS note above.
      const esign = mine && !alreadyDone && LIVE_ESIGN_KEYS.has(d.doc_key)
        ? await getOrCreateEsignLink(r.applicationId, d.doc_key, `token:pre-apply/${token}`).catch(() => null)
        : null
      return {
        id: d.id, doc_key: d.doc_key, label: d.label, provided_by: d.provided_by, required: d.required, note: d.note,
        requiresNotarization: d.requires_notarization, templateUrl: templateUrls.get(d.doc_key) ?? null,
        uploaded: alreadyDone || !!esign?.completed, mine, conditionKey: d.condition_key,
        esignUrl: esign && !esign.completed ? esign.url : null,
      }
    })),
    // The yes/no gates this association's checklist actually asks about, plus
    // whatever the applicant has answered so far.
    declarations,
    pendingDeclarations: pendingDeclarations(checklist, declarations),
    petsAllowed,
    petsProhibitedNotice: declaredPetWhereProhibited(declarations, petsAllowed),
    animalKinds: (['pet', 'service', 'esa', 'unsure'] as const).map(k => ({ key: k, label: ANIMAL_KIND_LABEL[k], blurb: ANIMAL_KIND_BLURB[k] })),
    // No "here's how to register your pet" guidance at an association that
    // permits none — it would sit directly under the notice saying pets are
    // not allowed and tell the applicant the opposite. The assistance-animal
    // guidance is never suppressed.
    animalGuidance: declarations.animal?.has && declarations.animal.kind
      && !declaredPetWhereProhibited(declarations, petsAllowed)
      ? animalDocGuidance(declarations.animal.kind) : null,
    animalUnsure: declarations.animal?.has === true && declarations.animal.kind === 'unsure',
    rules: (rules ?? []).map(r2 => ({ rule_key: r2.rule_key as string, label: r2.label as string })),
    collaborators: collaborators.map(s => ({
      id: s.id, name: s.name, email: maskEmail(s.email), role: s.role, roleLabel: roleLabel(s.role),
      isPrimary: s.isPrimary, status: s.status, signs: s.signs, signed: !!s.signedAt, emailVerified: !!s.emailVerifiedAt,
    })),
  })
}
