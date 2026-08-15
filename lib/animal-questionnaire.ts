// =====================================================================
// lib/animal-questionnaire.ts
//
// The Animal Information & Reasonable Accommodation Questionnaire, merged into
// the existing `pet_registration` e-sign document rather than standing beside
// it — one form, three branches.
//
// THE WHOLE POINT IS THE BRANCHING. The questions narrow so that an applicant
// is never asked about a disability unnecessarily:
//
//   animal? → pet or accommodation? → service or ESA?
//           → is the disability / the need for THIS animal readily apparent?
//           → only if not, the narrow supporting information the law permits
//
// Statutory basis supplied by the user: Fla. Stat. §760.27 (an association may
// request reliable information where the disability or the disability-related
// need is NOT readily apparent, and may not demand diagnosis, severity, or
// medical records) and §413.08; HUD's 2020 assistance-animal guidance (for a
// service dog whose task is not obvious, the inquiry is limited to whether the
// animal is required because of a disability and what work or task it has been
// trained to perform — it is NOT a request for medical documentation).
//
// ⚠ There is deliberately NO field anywhere in this module for a diagnosis,
// a condition, its severity, or medical records. That is a structural
// guarantee, not a policy note: MAIA cannot ask for what it has nowhere to
// put. See docs/ASSISTANCE-ANIMAL-PROCEDURE.md.
// =====================================================================

/** Q2 — what kind of request this is. 'unsure' is a real answer, not a missing
 *  one: an applicant who does not know whether their animal is an ESA must be
 *  able to say so and have staff sort it out, rather than guessing and being
 *  routed down the wrong branch. */
export type AnimalRequestType = 'pet' | 'service' | 'esa' | 'unsure'

export const REQUEST_TYPE_LABEL: Record<AnimalRequestType, string> = {
  pet: 'Regular household pet',
  service: 'Service animal trained to perform work or tasks because of a disability',
  esa: 'Emotional Support Animal (ESA) / assistance animal requested because of a disability',
  unsure: 'I am not sure',
}

export const REQUEST_TYPE_BLURB: Record<AnimalRequestType, string> = {
  pet: 'A companion animal that is not trained for, or needed because of, a disability.',
  service: 'Trained to perform work or a task related to a disability. Comfort alone does not make an animal a service animal.',
  esa: 'An animal that provides assistance or therapeutic emotional support related to a disability, without task training.',
  unsure: 'Choose this and staff will help you work out which applies. You will not be asked anything further right now.',
}

export type YesNo = 'yes' | 'no'
export type Tri = 'yes' | 'no' | 'unsure'

/** Q4-Q8 — the service-animal branch. */
export interface ServiceAnimalAnswers {
  /** Q4. Florida's service-animal definition is dog-specific; a "no" here is
   *  routed to the assistance-animal branch rather than refused, because the
   *  animal may still qualify for a reasonable accommodation. */
  isDog?: YesNo
  /** Q5. If the work or task is readily apparent (a dog guiding a person who
   *  is blind, observable mobility assistance), NOTHING further about the
   *  disability is asked. */
  taskApparent?: YesNo
  /** Q6 — asked only when Q5 is 'no'. */
  requiredForDisability?: YesNo
  /** Q7 — asked only when Q5 is 'no'. The task, never the diagnosis. */
  taskDescription?: string
  /** Q8. */
  vaccinatedAndLicensed?: YesNo
}

/** Q9-Q18 — the assistance-animal / ESA branch. */
export interface EsaAnswers {
  /** Q9. */
  requestingAccommodation?: YesNo
  /** Q10. 'defer' = "prefer that Management determine whether additional
   *  documentation is necessary" — an explicit option so the applicant is not
   *  pushed into volunteering documentation nobody asked for. */
  disabilityApparent?: 'yes' | 'no' | 'defer'
  /** Q11. */
  needApparent?: Tri
  /** Q13. Documentation of need may be requested for EACH animal. */
  animalCount?: number
  /** Q14. */
  documentation?: 'attached' | 'separate' | 'none' | 'unnecessary'
  /** The files behind a Q14 answer of 'attached'. Answering "attached" with
   *  nowhere to attach was the original gap here. */
  documentationFiles?: { path: string; filename: string }[]
  /** Q15 — identification of the practitioner, never the contents of care. */
  provider?: {
    name?: string
    title?: string
    licenseNumber?: string
    licenseState?: string
    contact?: string
  }
  /** Q16. An online ESA registration, certificate, ID card, vest or patch is
   *  not, on its own, sufficient — but it is also not disqualifying. */
  onlineRegistryOnly?: 'yes' | 'no' | 'na'
  /** Q17. An out-of-state practitioner must be properly licensed AND have
   *  provided in-person care at least once. */
  outOfState?: {
    licenseState?: string
    hasTreatedYou?: YesNo
    inPersonAtLeastOnce?: 'yes' | 'no' | 'na'
  }
  /** Q18. */
  vaccinatedAndLicensed?: YesNo
}

export interface AnimalQuestionnaire {
  requestType?: AnimalRequestType
  service?: ServiceAnimalAnswers
  esa?: EsaAnswers
  /** Q3 (pet) asks whether the animal is vaccinated as required by law. */
  petVaccinated?: YesNo
}

// ── Branching ────────────────────────────────────────────────────────

/** Which branch the answers actually land in. Q4 = "not a dog" moves a service
 *  request onto the assistance-animal branch — the animal may still qualify,
 *  and dropping it there would quietly deny an accommodation. */
export function effectiveBranch(q: AnimalQuestionnaire | null | undefined): 'pet' | 'service' | 'esa' | 'unsure' | null {
  const t = q?.requestType
  if (!t) return null
  if (t === 'service' && q?.service?.isDog === 'no') return 'esa'
  return t
}

/** Q6 and Q7 exist ONLY when the task is not readily apparent. When it is
 *  apparent, HUD guidance is that no further disability inquiry is necessary,
 *  and asking anyway is the failure mode this branch exists to prevent. */
export function asksServiceTaskDetail(q: AnimalQuestionnaire | null | undefined): boolean {
  return effectiveBranch(q) === 'service' && q?.service?.taskApparent === 'no'
}

/** Documentation of the DISABILITY may be requested only where the disability
 *  is not readily apparent. 'defer' leaves the decision with management, so it
 *  does not by itself open the request. */
export function asksDisabilityDocumentation(q: AnimalQuestionnaire | null | undefined): boolean {
  return effectiveBranch(q) === 'esa' && q?.esa?.disabilityApparent === 'no'
}

/** Documentation of the NEED for this animal may be requested only where that
 *  need is not readily apparent. */
export function asksNeedDocumentation(q: AnimalQuestionnaire | null | undefined): boolean {
  const v = q?.esa?.needApparent
  return effectiveBranch(q) === 'esa' && (v === 'no' || v === 'unsure')
}

/** Practitioner identification (Q15-Q17) is only reached when documentation is
 *  actually in play AND the applicant is supplying some. */
export function asksProviderDetail(q: AnimalQuestionnaire | null | undefined): boolean {
  if (!asksDisabilityDocumentation(q) && !asksNeedDocumentation(q)) return false
  const d = q?.esa?.documentation
  return d === 'attached' || d === 'separate'
}

/** Documentation of need for EACH animal, where more than one is requested. */
export function asksPerAnimalNeed(q: AnimalQuestionnaire | null | undefined): boolean {
  return effectiveBranch(q) === 'esa' && (q?.esa?.animalCount ?? 1) > 1
}

/** The animal fields the completeness check needs to see. */
export interface AnimalFileState {
  name?: string
  vaccinationDoc?: { path: string; filename: string } | null
  photo?: { path: string; filename: string } | null
}

/** Proof of vaccination and licensing IS requestable — for a service animal
 *  and an assistance animal as much as for a pet (Fla. Stat. §760.27 permits
 *  it where the association requires it of animals generally). So when the
 *  applicant answers "yes, it is vaccinated and licensed", the record is
 *  required: an unevidenced "yes" is the same as not asking.
 *
 *  A "no" does NOT demand a file. Someone who says the animal is not currently
 *  vaccinated cannot produce a record, and blocking the form there would only
 *  teach them to answer "yes". That becomes a compliance item for staff. */
export function requiresVaccinationRecord(q: AnimalQuestionnaire | null | undefined): boolean {
  const branch = effectiveBranch(q)
  if (branch === 'pet') return q?.petVaccinated === 'yes'
  if (branch === 'service') return q?.service?.vaccinatedAndLicensed === 'yes'
  if (branch === 'esa') return q?.esa?.vaccinatedAndLicensed === 'yes'
  return false
}

/** A photo is required for EVERY animal — pet, service animal and assistance
 *  animal alike (user direction, 2026-08-15, after the alternative was put to
 *  them). Gate and security staff need to be able to recognise the animal that
 *  was approved for the property, and that need does not change with the
 *  animal's legal category.
 *
 *  It is asked identically of every branch on purpose. A photo requirement
 *  applied ONLY to assistance animals would single them out; applied to all
 *  animals it is a neutral, generally-applicable rule. It must never be used to
 *  assess breed, size or appearance — those may not be applied to an assistance
 *  animal at all, and no part of MAIA reads this file.
 *
 *  'unsure' asks for no animal details at all, so no photo. */
export function requiresPhoto(q: AnimalQuestionnaire | null | undefined): boolean {
  const b = effectiveBranch(q)
  return b !== null && b !== 'unsure'
}

/** What is still unanswered, in the applicant's own words. Empty = ready to
 *  sign. Only questions the branch actually reaches are ever required. */
export function missingAnswers(q: AnimalQuestionnaire | null | undefined, animals: AnimalFileState[] = []): string[] {
  const out: string[] = []
  const branch = effectiveBranch(q)
  const named = animals.filter(a => (a.name ?? '').trim())
  const petNamed = named.length > 0
  if (!q?.requestType) { out.push('What type of request are you making?'); return out }
  if (branch === 'unsure') return out   // nothing further is asked

  const fileGaps = () => {
    const label = branch === 'pet' ? 'pet' : 'animal'
    if (requiresVaccinationRecord(q)) {
      const missingVax = named.filter(a => !a.vaccinationDoc)
      for (const a of missingVax) {
        out.push(`The vaccination / licensing record for ${a.name!.trim()} — you answered that the ${label} is vaccinated and licensed`)
      }
    }
    if (requiresPhoto(q)) {
      for (const a of named.filter(a => !a.photo)) out.push(`A photo of ${a.name!.trim()}`)
    }
  }

  if (branch === 'pet') {
    if (!petNamed) out.push('The pet’s name')
    if (!q.petVaccinated) out.push('Is the animal currently vaccinated as required by law?')
    fileGaps()
    return out
  }

  if (branch === 'service') {
    if (!q.service?.isDog) out.push('Is the animal a dog?')
    if (!q.service?.taskApparent) out.push('Is it readily apparent what work or task the dog performs?')
    if (asksServiceTaskDetail(q)) {
      if (!q.service?.requiredForDisability) out.push('Is the animal required because of a disability?')
      if (!(q.service?.taskDescription ?? '').trim()) out.push('What work or task has the animal been trained to perform?')
    }
    if (!q.service?.vaccinatedAndLicensed) out.push('Is the animal vaccinated and licensed as required by law?')
    if (!petNamed) out.push('The animal’s name')
    fileGaps()
    return out
  }

  // esa
  if (!q.esa?.requestingAccommodation) out.push('Are you requesting a reasonable accommodation because of a disability?')
  if (q.esa?.requestingAccommodation === 'no') return out
  if (!q.esa?.disabilityApparent) out.push('Is your disability readily apparent or already known to the Association?')
  if (!q.esa?.needApparent) out.push('Is the disability-related need for this particular animal readily apparent?')
  if ((asksDisabilityDocumentation(q) || asksNeedDocumentation(q)) && !q.esa?.documentation) {
    out.push('Do you have reliable supporting documentation?')
  }
  if (q.esa?.documentation === 'attached' && !(q.esa?.documentationFiles ?? []).length) {
    out.push('The supporting documentation file you said is attached')
  }
  if (asksProviderDetail(q) && !(q.esa?.provider?.name ?? '').trim()) out.push('The healthcare professional’s name')
  if (!q.esa?.vaccinatedAndLicensed) out.push('Is the animal vaccinated and licensed as required by law?')
  if (!petNamed) out.push('The animal’s name')
  fileGaps()
  return out
}

// ── Certification ────────────────────────────────────────────────────

export const PET_CERTIFICATION =
  'I certify the information above is true and complete. I have read and agree to comply with the Association’s pet rules and restrictions, I will keep each animal’s vaccinations current, and I understand registration may be revoked for violations.'

export const ASSISTANCE_ANIMAL_CERTIFICATION =
  'I certify that the information provided in connection with this request is true and accurate to the best of my knowledge. ' +
  'I understand that I am not required to disclose my diagnosis, the severity of my disability, or my complete medical records as part of this request. ' +
  'I understand that an approved service or assistance animal is not considered an ordinary pet; however, I remain responsible for properly controlling the animal, ' +
  'complying with applicable health and safety requirements, properly disposing of animal waste, and for damage caused by the animal as permitted by law.'

export function certificationFor(q: AnimalQuestionnaire | null | undefined): string {
  return effectiveBranch(q) === 'pet' ? PET_CERTIFICATION : ASSISTANCE_ANIMAL_CERTIFICATION
}

/** The document title, so a signed accommodation request is never filed under
 *  a name that calls it a pet. */
export function documentTitleFor(q: AnimalQuestionnaire | null | undefined, unitLabel: string): string {
  const b = effectiveBranch(q)
  if (b === 'service') return `Service Animal Information — Unit ${unitLabel}`
  if (b === 'esa') return `Assistance Animal Accommodation Request — Unit ${unitLabel}`
  if (b === 'unsure') return `Animal Information — Unit ${unitLabel}`
  return `Pet Registration — Unit ${unitLabel}`
}

/** Whether the association's ordinary pet rules, procedures and FEES apply.
 *  An approved service or assistance animal is not a pet, and no pet fee, pet
 *  deposit, surcharge, or breed/size restriction may attach to it. */
export function petRulesApply(q: AnimalQuestionnaire | null | undefined): boolean {
  return effectiveBranch(q) === 'pet'
}
