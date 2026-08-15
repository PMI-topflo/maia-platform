# Assistance Animals — build spec for the application flow

**Status: BUILT, except the board decision record (step 4).** Shipped 2026-08-15 in `supabase/migrations/20260815_vehicle_animal_declarations.sql` + `lib/animal-accommodation.ts`. `associations.pets_allowed` is now declared in a migration (it had only ever been set straight on production) and answered for all 26 associations — MANXI `false`, everything else `true` per the user's "pets allowed is the default".

The applicant declares the animal and its kind themselves at `/pre-apply/[code]`; `activeConditions()` routes pet vs assistance animal; `animalDocGuidance()` is the single source for what may and may not be asked, and is shown to BOTH the applicant and staff. Guarded by `npm run test:gate` — case 7 is the guarantee that `pets_allowed = false` never closes the accommodation path.

The rules below were supplied by the user, sourced to Fla. Stat. §760.27, §413.08 and HUD's 2020 assistance-animal guidance. They are the product spec and they are built.

**MAIA organises the process; the board decides.** That is a design rule, not a disclaimer: nothing here denies, approves, or auto-rejects anything. What the code guarantees is narrower and more useful — that the questions narrow correctly, that an apparent disability or an apparent need is never asked for documentation, and that there is nowhere in the system to put a diagnosis, a severity, or a medical record. The decision itself is recorded by a human on the board decision page.

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

## What was built

1. ✅ **Applicant declares** whether they have an animal, in the same card as the vehicle question. `listing_applications.declarations`; `POST /api/pre-apply/[token]/declare`. An unanswered gate hides the item AND blocks submission, so silence is never read as "no".
2. ✅ **Branch on `associations.pets_allowed`** — `true` → the `pet_registration` e-sign form; `false` → the pet path closes and the accommodation path opens. A pet declared where pets are prohibited is never silently dropped: `declaredPetWhereProhibited()` tells the applicant and flags staff.
3. ✅ **Branch again on animal type.** `assistance_animal_documentation` is seeded on every association × every application type. The service-animal path lists "a doctor's letter or any medical documentation" under *must never be requested*.
4. ⏳ **Board/staff review decision record** — NOT built. Staff currently see the guidance, the narrow denial grounds and the ~10-day clock on `/admin/pre-apply/[id]`, but there is no structured decision row, no clock that actually runs, and no reminder. This is the remaining piece.
5. ⏳ **Fee guard** — stated in the copy shown to applicants and staff, but nothing mechanically blocks a fee, because no animal fee exists in the system to block yet.
6. ✅ `pets_allowed` set for all 26 associations. **These were defaulted, not answered** — each board should still confirm its own, and the 5 commercial/industrial associations (ESSI, KANE, MACO, WBP, WBPA) plus the 2 master/rec entities (LCLUB, VPREC) are defaults of convenience.

Step 4 records the board's decision — it does not make one. The narrow denial grounds and the review window are shown to whoever is deciding; MAIA never applies them itself.

## Related

- `lib/esign-forms.tsx` → `pet_registration` (the ordinary-pet path, already built and wired)
- `docs/SESSION-HANDOFF.md` → current status
- Manors XI packet rule 10: "NO PETS ALLOWED AT ANY TIME" — which is exactly why this branch is needed there.
