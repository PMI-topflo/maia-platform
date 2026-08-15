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
import { maskEmail } from '@/lib/esign-verify'

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
    supabaseAdmin.from('listing_applications').select('declarations').eq('id', r.applicationId).maybeSingle(),
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
  const visible = checklist.filter(d => applies(d.condition_key))

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
    // The current stakeholder holding this token
    me: {
      name: me.name, role: me.role, roleLabel: roleLabel(me.role), signs: me.signs,
      isPrimary: me.isPrimary, status: me.status, emailVerified: !!me.emailVerifiedAt,
      emailMasked: maskEmail(me.email), signed: !!me.signedAt,
    },
    canAddCollaborators: me.isPrimary,
    submitted: !!intake.submittedAt,
    providerLabels: PROVIDED_BY_LABEL,
    // Every checklist item, flagged "mine" (this stakeholder provides it) + uploaded
    checklist: visible.map(d => ({
      id: d.id, doc_key: d.doc_key, label: d.label, provided_by: d.provided_by, required: d.required, note: d.note,
      requiresNotarization: d.requires_notarization, templateUrl: templateUrls.get(d.doc_key) ?? null,
      uploaded: uploaded.has(d.doc_key), mine: d.provided_by === myProvidedBy,
      conditionKey: d.condition_key,
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
