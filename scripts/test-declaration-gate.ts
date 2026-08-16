// =====================================================================
// scripts/test-declaration-gate.ts   —   npm run test:gate
//
// The vehicle / animal declaration gate, exercised directly. Both surfaces
// that use it are auth-gated, and the fair-housing cases are the kind that
// break silently: `pets_allowed = false` must close the ORDINARY PET path and
// never the reasonable-accommodation path for a service animal or an ESA.
// Case 7 is that guarantee. Case 2 is the bug this whole gate exists to fix —
// a car-free applicant who could never reach complete.
// =====================================================================

import { activeConditions, declaredPetWhereProhibited } from '../lib/animal-accommodation'
import {
  missingAnswers, requiresVaccinationRecord, requiresPhoto, effectiveBranch, asksServiceTaskDetail,
  asksDisabilityDocumentation, type AnimalQuestionnaire,
} from '../lib/animal-questionnaire'
import { declaredNaKeys, pendingDeclarations, type Declarations } from '../lib/intake-documents'

const CHECKLIST = [
  { doc_key: 'drivers_license',                 condition_key: null },
  { doc_key: 'car_registration',                condition_key: 'vehicle' },
  { doc_key: 'vehicle_insurance',               condition_key: 'vehicle' },
  { doc_key: 'pet_registration',                condition_key: 'pet' },
  { doc_key: 'assistance_animal_documentation', condition_key: 'assistance_animal' },
]

let fails = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  const ok = g === w
  if (!ok) fails++
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}${ok ? '' : `\n      got  ${g}\n      want ${w}`}`)
}

const S = (d: Declarations, petsAllowed: boolean | null) =>
  declaredNaKeys(CHECKLIST, d, { petsAllowed }).sort()

// 1. Nothing answered → nothing retired, both gates still pending.
eq('unanswered retires nothing', S({}, true), [])
eq('unanswered gates are pending', pendingDeclarations(CHECKLIST, {}), ['vehicle', 'animal'])

// 2. THE BUG THIS FIXES: a car-free applicant.
eq('no vehicle retires both vehicle docs',
  S({ vehicle: { has: false } }, true), ['car_registration', 'vehicle_insurance'])
eq('vehicle answered clears its gate',
  pendingDeclarations(CHECKLIST, { vehicle: { has: false } }), ['animal'])

// 3. Has a vehicle → nothing retired.
eq('has vehicle retires nothing', S({ vehicle: { has: true } }, true), [])

// 4. No animal → both animal paths retired, at either kind of association.
eq('no animal, pets allowed', S({ animal: { has: false } }, true),
  ['assistance_animal_documentation', 'pet_registration'])
eq('no animal, no-pets association', S({ animal: { has: false } }, false),
  ['assistance_animal_documentation', 'pet_registration'])

// 5. Animal declared but kind not yet chosen → BOTH paths stay open.
eq('animal yes, kind unanswered keeps both open', S({ animal: { has: true, kind: null } }, true), [])

// 6. An ordinary pet at a pets-allowed association.
eq('pet at pets-allowed → only assistance path retired',
  S({ animal: { has: true, kind: 'pet' } }, true), ['assistance_animal_documentation'])

// 7. THE FAIR-HOUSING CASE: pets_allowed=false must NOT close the accommodation path.
for (const kind of ['service', 'esa'] as const) {
  eq(`${kind} animal at a NO-PETS association keeps the accommodation path open`,
    S({ animal: { has: true, kind } }, false), ['pet_registration'])
  eq(`${kind} animal condition is active at a NO-PETS association`,
    [...activeConditions({ animal: { has: true, kind } }, { petsAllowed: false })], ['assistance_animal'])
}

// 8. A pet declared where pets are prohibited: retire the registration, raise a flag.
eq('pet at no-pets association retires the pet registration',
  S({ animal: { has: true, kind: 'pet' } }, false),
  ['assistance_animal_documentation', 'pet_registration'])
eq('…and flags it for staff',
  declaredPetWhereProhibited({ animal: { has: true, kind: 'pet' } }, false), true)
eq('no flag when pets are allowed',
  declaredPetWhereProhibited({ animal: { has: true, kind: 'pet' } }, true), false)
eq('a service animal is never flagged as a prohibited pet',
  declaredPetWhereProhibited({ animal: { has: true, kind: 'service' } }, false), false)

// 9. An association with no conditional items never asks anything.
eq('no conditional items → no gates',
  pendingDeclarations([{ condition_key: null }], {}), [])

// ── The questionnaire branch + its required files ────────────────────
const FILE = { path: 'esign/x', filename: 'x.pdf' }
const animal = (extra: Record<string, unknown> = {}) => [{ name: 'Rex', ...extra }]
const Q = (q: AnimalQuestionnaire) => q

// 10. "Not a dog" moves a SERVICE request onto the accommodation branch rather
//     than refusing it — the animal may still qualify.
eq('service + not a dog routes to the assistance branch',
  effectiveBranch(Q({ requestType: 'service', service: { isDog: 'no' } })), 'esa')

// 11. A readily-apparent task ends the disability inquiry.
eq('apparent task asks nothing further',
  asksServiceTaskDetail(Q({ requestType: 'service', service: { isDog: 'yes', taskApparent: 'yes' } })), false)
eq('non-apparent task asks the two permitted questions',
  asksServiceTaskDetail(Q({ requestType: 'service', service: { isDog: 'yes', taskApparent: 'no' } })), true)

// 12. An apparent disability never triggers a documentation request.
eq('apparent disability requests no documentation',
  asksDisabilityDocumentation(Q({ requestType: 'esa', esa: { disabilityApparent: 'yes' } })), false)
eq('"let management decide" is not itself a documentation request',
  asksDisabilityDocumentation(Q({ requestType: 'esa', esa: { disabilityApparent: 'defer' } })), false)

// 13. A "yes, vaccinated and licensed" must come with the record — on EVERY
//     branch. An unevidenced yes is the same as not asking.
for (const [name, q] of [
  ['pet', Q({ requestType: 'pet', petVaccinated: 'yes' })],
  ['service', Q({ requestType: 'service', service: { isDog: 'yes', taskApparent: 'yes', vaccinatedAndLicensed: 'yes' } })],
  ['esa', Q({ requestType: 'esa', esa: { requestingAccommodation: 'yes', disabilityApparent: 'yes', needApparent: 'yes', vaccinatedAndLicensed: 'yes' } })],
] as [string, AnimalQuestionnaire][]) {
  eq(`${name}: "yes vaccinated" requires the record`, requiresVaccinationRecord(q), true)
  eq(`${name}: missing record blocks`, missingAnswers(q, animal({ photo: FILE })).some(m => m.includes('vaccination')), true)
  eq(`${name}: record supplied clears it`, missingAnswers(q, animal({ vaccinationDoc: FILE, photo: FILE })).some(m => m.includes('vaccination')), false)
}

// 14. …but "no" never demands a file it cannot have.
eq('"not vaccinated" does not demand a record',
  requiresVaccinationRecord(Q({ requestType: 'pet', petVaccinated: 'no' })), false)

// 15. A photo is required for EVERY animal — the rule is generally applicable
//     rather than aimed at assistance animals, which is what keeps it neutral.
eq('photo required for a pet', requiresPhoto(Q({ requestType: 'pet' })), true)
eq('photo required for a service animal', requiresPhoto(Q({ requestType: 'service', service: { isDog: 'yes' } })), true)
eq('photo required for an ESA', requiresPhoto(Q({ requestType: 'esa' })), true)
eq('missing photo blocks an ESA too',
  missingAnswers(Q({ requestType: 'esa', esa: { requestingAccommodation: 'yes', disabilityApparent: 'yes', needApparent: 'yes', vaccinatedAndLicensed: 'yes' } }),
    animal({ vaccinationDoc: FILE })).some(m => m.includes('photo')), true)
eq('photo supplied clears an ESA',
  missingAnswers(Q({ requestType: 'esa', esa: { requestingAccommodation: 'yes', disabilityApparent: 'yes', needApparent: 'yes', vaccinatedAndLicensed: 'yes' } }),
    animal({ vaccinationDoc: FILE, photo: FILE })), [])
// 'unsure' collects no animal at all, so it must not demand a photo.
eq('unsure never demands a photo', requiresPhoto(Q({ requestType: 'unsure' })), false)

// 16. "Yes — attached" with nothing attached is not a complete answer.
eq('"attached" with no file blocks',
  missingAnswers(Q({ requestType: 'esa', esa: { requestingAccommodation: 'yes', disabilityApparent: 'no', needApparent: 'no', documentation: 'attached', provider: { name: 'Dr. A' }, vaccinatedAndLicensed: 'yes' } }),
    animal({ vaccinationDoc: FILE })).some(m => m.includes('supporting documentation')), true)

// 17. "I am not sure" asks for nothing at all.
eq('unsure requires nothing', missingAnswers(Q({ requestType: 'unsure' }), []), [])

console.log(fails === 0 ? '\nAll gate cases pass.' : `\n${fails} FAILING`)
process.exit(fails === 0 ? 0 : 1)
