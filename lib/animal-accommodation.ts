// =====================================================================
// lib/animal-accommodation.ts
//
// The animal branch of the applicant declaration, in one place.
//
// A PET and an ASSISTANCE ANIMAL are different things, and conflating them is
// the main way this goes wrong. An association that does not allow pets must
// still consider a reasonable accommodation for a qualified applicant's
// service animal or emotional support animal — so `associations.pets_allowed
// = false` closes the PET path and OPENS the accommodation path. It never
// means "no animal questions".
//
// Sources for the rules encoded here: Fla. Stat. §760.27 and §413.08, and HUD
// guidance. Captured from docs/ASSISTANCE-ANIMAL-PROCEDURE.md.
//
// ⚠ MAIA ORGANISES THIS PROCESS; IT DOES NOT ADJUDICATE IT. Nothing in this
// module denies, delays, or auto-rejects anything. It decides which documents
// to ASK for and which questions are forbidden — the decision stays with the
// board, recorded on the board decision page. Refusing an assistance animal
// wrongly, or demanding a document the statute forbids, is fair-housing
// exposure, which is why the guardrails below are structural rather than
// advisory.
// =====================================================================

/** Mirrors AnimalRequestType in lib/animal-questionnaire.ts. 'unsure' is a
 *  real answer: an applicant who does not know whether their animal is an ESA
 *  must be able to say so rather than be routed down the wrong branch. */
export type AnimalKind = 'pet' | 'service' | 'esa' | 'unsure'

export const ANIMAL_KIND_LABEL: Record<AnimalKind, string> = {
  pet: 'A pet',
  service: 'A service animal',
  esa: 'An emotional support / assistance animal',
  unsure: 'I am not sure',
}

export const ANIMAL_KIND_BLURB: Record<AnimalKind, string> = {
  pet: 'A companion animal that is not trained for, or needed because of, a disability.',
  service: 'Trained to perform a task related to a disability. Comfort alone does not make an animal a service animal.',
  esa: 'An animal whose presence eases the effects of a disability, without task training.',
  unsure: 'Staff will help you work out which applies. You will not be asked anything about a disability here.',
}

/** An assistance animal is never governed by the association's pet rules. */
export function isAssistanceAnimal(kind: AnimalKind | null | undefined): boolean {
  return kind === 'service' || kind === 'esa'
}

/** Which `condition_key` values are live for this declaration. A checklist
 *  item with a condition_key not in this set does not apply to the applicant
 *  and is excluded from everything that asks "what's still missing".
 *
 *  `petsAllowed === false` suppresses the ORDINARY PET path only — there is no
 *  pet to register at an association that permits none. It never suppresses
 *  the assistance-animal path, which exists precisely because a no-pet
 *  association must still consider a reasonable accommodation. A pet declared
 *  at a no-pet association is a conversation for staff (see
 *  `declaredPetWhereProhibited`), not something to quietly drop. */
export function activeConditions(
  d: {
    vehicle?: { has?: boolean } | null
    animal?: { has?: boolean; kind?: AnimalKind | null } | null
    /** Purchase-only: "Do you have 2 years of U.S. tax returns?" has=false
     *  is the international-applicant branch (no U.S. credit/tax history) —
     *  opens the CPA-certification / police-clearance checklist items. */
    taxReturns?: { has?: boolean } | null
  } | null | undefined,
  opts?: { petsAllowed?: boolean | null },
): Set<string> {
  const on = new Set<string>()
  if (d?.vehicle?.has) on.add('vehicle')
  if (d?.taxReturns?.has === false) on.add('international')
  if (d?.animal?.has) {
    const kind = d.animal.kind ?? null
    const petsAllowed = opts?.petsAllowed !== false
    // An undeclared or unsure kind keeps BOTH animal paths open rather than
    // guessing — asking twice is recoverable, silently closing the
    // accommodation path is not.
    const undecided = !kind || kind === 'unsure'
    if ((undecided || kind === 'pet') && petsAllowed) on.add('pet')
    if (undecided || isAssistanceAnimal(kind)) on.add('assistance_animal')
  }
  return on
}

/** The applicant says they have an ordinary pet, but this association permits
 *  none. Staff need to see this, and the applicant needs to be told — quietly
 *  retiring the pet registration would leave both sides believing the animal
 *  had been disclosed and accepted. */
export function declaredPetWhereProhibited(
  d: { animal?: { has?: boolean; kind?: AnimalKind | null } | null } | null | undefined,
  petsAllowed: boolean | null | undefined,
): boolean {
  return petsAllowed === false && !!d?.animal?.has && d.animal.kind === 'pet'
}

/** What MAIA may ask for, given the kind of animal. Deliberately expressed as
 *  "may request" — every one of these is a request, never a precondition that
 *  MAIA enforces on its own. */
export interface AnimalDocGuidance {
  heading: string
  intro: string
  mayRequest: string[]
  mustNotRequest: string[]
  /** Shown to staff, not the applicant. */
  staffNote: string
}

const NEVER_FOR_ANY_ASSISTANCE_ANIMAL = [
  'A diagnosis, the severity of a condition, or any medical records',
  'Notarization of the applicant\'s statement',
  'The association\'s own form as the only accepted route — it may be offered, never required',
  'A pet fee, pet deposit, surcharge, or accommodation processing fee',
  'A breed or size restriction',
  'An online "ESA certificate", registration, ID card or vest treated as sufficient on its own',
]

export function animalDocGuidance(kind: AnimalKind): AnimalDocGuidance | null {
  // 'unsure' asks NOTHING. Falling through to the pet guidance here would tell
  // an applicant who may be requesting an accommodation to go register a pet.
  if (kind === 'unsure') return null
  if (kind === 'service') {
    return {
      heading: 'Service animal',
      intro:
        'If the animal\'s task is obvious — a guide dog, for instance — nothing is asked at all. If it is not obvious, exactly two questions may be asked, and no more.',
      mayRequest: [
        'Is the animal required because of a disability?',
        'What work or task has the animal been trained to perform?',
        'Proof of vaccination or licensing compliance, where the association requires it of animals generally',
      ],
      mustNotRequest: [
        'A doctor\'s letter or any medical documentation',
        'A service-animal certificate, training certificate, ID card or vest',
        ...NEVER_FOR_ANY_ASSISTANCE_ANIMAL,
      ],
      staffNote:
        'A service animal is never asked for medical documentation — not a letter, not a certificate, not a diagnosis. If the task is obvious, ask nothing.',
    }
  }
  if (kind === 'esa') {
    return {
      heading: 'Emotional support / assistance animal',
      intro:
        'If the disability is readily apparent, no documentation of it is requested. If it is not, reliable information that the applicant has a qualifying disability may be requested, along with information connecting the disability to this particular animal.',
      mayRequest: [
        'Reliable information of a qualifying disability from a physician, psychologist, psychiatrist, nurse practitioner, other qualified practitioner, telehealth provider, government disability determination, or benefits documentation',
        'Information connecting the disability to this particular animal',
        'Where there is more than one animal, documentation of the need for each one',
        'Proof of vaccination or licensing compliance, where the association requires it of animals generally',
      ],
      mustNotRequest: NEVER_FOR_ANY_ASSISTANCE_ANIMAL,
      staffNote:
        'Telehealth documentation is not automatically invalid — the test is whether the provider has genuine professional knowledge of the patient. An out-of-state practitioner must be properly licensed AND have provided in-person care at least once.',
    }
  }
  return {
    heading: 'Pet',
    intro: 'Register each pet on the association\'s pet registration form and sign it.',
    mayRequest: [
      'One entry per pet: name, type, breed, weight and age',
      'The rabies vaccination date for each pet (the registration renews from the earliest one)',
      'The household\'s veterinarian',
    ],
    mustNotRequest: [],
    staffNote: '',
  }
}

/** The narrow grounds on which an assistance animal may be refused. Surfaced
 *  to staff as a reminder; MAIA never applies them itself. */
export const ASSISTANCE_ANIMAL_DENIAL_GROUNDS = [
  'This specific animal is a direct threat to health or safety, or of physical damage, that no other accommodation would reduce — based on THIS animal\'s actual behaviour, never a breed stereotype.',
  'Documentation of a non-obvious disability, or of a non-obvious need, remains inadequate AFTER the applicant has had a fair opportunity to supply it.',
]

/** HUD guidance: decide promptly, generally within about ten days of receiving
 *  the supporting documentation. */
export const ASSISTANCE_ANIMAL_DECISION_DAYS = 10
