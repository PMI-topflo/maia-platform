# Assistance Animals — build spec for the application flow

**Status: SPEC ONLY. Not built.** `associations.pets_allowed` exists and is set for MANXI (false) and VPCI (true); everything below is what still needs building.

> ⚠️ **Get this reviewed before it gates a real application.** The rules below were supplied by the user (sourced to Fla. Stat. §760.27, §413.08 and HUD guidance) and are captured here as the product spec. A Florida community-association attorney should sign off before MAIA denies, delays, or demands documents from a real applicant — refusing an assistance animal wrongly, or demanding a document the statute forbids, is a fair-housing exposure. MAIA should organise the process, never adjudicate it.

## The core distinction

A **pet** and an **assistance animal** are different things. A "no pets" association must still consider a reasonable accommodation for a qualified applicant's assistance animal. `pets_allowed = false` must therefore NOT mean "no animal questions" — it means the pet path is closed and the accommodation path opens.

Two kinds of assistance animal, with **different documentation rules**. Conflating them is the main way this goes wrong.

### Service animal
Trained to perform a task related to the disability. Emotional comfort alone does **not** qualify.

- If the task is **obvious** (e.g. a guide dog) → ask nothing.
- If not obvious → **only two questions**: (1) Is the animal required because of a disability? (2) What work or task has it been trained to perform?
- **May** require proof of vaccination/licensing compliance.
- **MUST NOT** request: doctor's letter, service-animal certificate, training certificate, ID card, vest, or the diagnosis.

### Emotional Support / Assistance Animal (ESA)
- If the disability is **not readily apparent**, may request reliable information that the person has a qualifying disability — from a physician, psychologist, psychiatrist, nurse practitioner, other qualified practitioner, telehealth provider, government disability determination, or benefits documentation.
- May request information connecting the disability to **that** animal.
- Multiple animals → documentation of the need for **each**.
- Out-of-state practitioner: must be properly licensed **and** have provided in-person care at least once.

## Hard prohibitions — encode these as guardrails, not guidelines

MAIA must be structurally incapable of asking for these:

- ❌ Diagnosis, severity, or medical records
- ❌ Notarization of the applicant's statement
- ❌ The association's own form as the **only** accepted route (offer it, never require it)
- ❌ Pet fee, pet deposit, surcharge, or accommodation processing fee
- ❌ Breed or size restrictions applied to an assistance animal
- ❌ Treating an online ESA certificate/registration/ID/vest as sufficient **on its own**

Telehealth documentation is **not** automatically invalid — the test is whether the provider has genuine professional knowledge of the patient.

## Denial grounds (narrow)

- The specific animal is a direct threat to health/safety or of physical damage, not reducible by another accommodation — based on **that animal's** actual behaviour, never breed stereotype.
- Documentation of a non-obvious disability or non-obvious need remains inadequate **after** a fair opportunity to supply it.

HUD guidance: decide promptly, generally within ~10 days of receiving supporting documentation.

## What to build

1. **Applicant declares** whether they have an animal (part of the same yes/no gate as the vehicle question).
2. **Branch on `associations.pets_allowed`:**
   - `true` → existing `pet_registration` e-sign form.
   - `false` → assistance-animal accommodation request; the ordinary pet path stays closed.
3. **Branch again on animal type** (service vs ESA) into the two document sets above. The service-animal path must NOT request medical documentation.
4. **Board/staff review** with a decision record, the narrow denial grounds, and the ~10-day clock.
5. **Fee guard:** no animal-related fee can attach to an approved assistance animal.
6. Set `pets_allowed` for the remaining **24 associations** — each needs its board's answer, not a guess.

## Related

- `lib/esign-forms.tsx` → `pet_registration` (the ordinary-pet path, already built and wired)
- `docs/SESSION-HANDOFF.md` → current status
- Manors XI packet rule 10: "NO PETS ALLOWED AT ANY TIME" — which is exactly why this branch is needed there.
