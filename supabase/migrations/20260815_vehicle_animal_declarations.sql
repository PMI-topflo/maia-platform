-- =====================================================================
-- 20260815_vehicle_animal_declarations.sql
--
-- Two related gaps, both of which leave a real applicant permanently stuck:
--
-- 1. VEHICLE / ANIMAL ITEMS WERE UNCONDITIONALLY REQUIRED. A Venetian Park I
--    applicant with no car can never satisfy "Vehicle Registration", so their
--    application can never reach complete. Only staff could clear it, by
--    hand, via na_items. Now a checklist item can carry a `condition_key`,
--    and the applicant answers the yes/no question themselves.
--
-- 2. `pets_allowed = false` MUST NOT MEAN "no animal questions". A no-pet
--    association still has to consider a reasonable accommodation for a
--    service animal or an ESA. The declaration therefore asks WHAT KIND of
--    animal, and the two paths collect different documents — see
--    docs/ASSISTANCE-ANIMAL-PROCEDURE.md and lib/animal-accommodation.ts.
--    MAIA organises that process; it never adjudicates it.
--
-- All ALTERs are additive and idempotent.
-- =====================================================================

-- ── associations.pets_allowed ────────────────────────────────────────
-- The column was added directly to production during the 2026-08-15 session
-- and never registered, so a fresh environment would not have it. Declared
-- here for real. Nullable on purpose: NULL means "this board has not been
-- asked yet", which is not the same as "pets are allowed".
ALTER TABLE public.associations ADD COLUMN IF NOT EXISTS pets_allowed boolean;

COMMENT ON COLUMN public.associations.pets_allowed IS
  'Whether ordinary pets are permitted. NULL = the board has not been asked. FALSE closes the pet path only — a service animal or ESA is a reasonable-accommodation request and is never governed by this flag.';

-- Pets allowed is the default answer (user direction, 2026-08-15). MANXI is
-- already false from its own packet ("NO PETS ALLOWED AT ANY TIME") and VPCI
-- is already true; COALESCE leaves both untouched.
UPDATE public.associations SET pets_allowed = true WHERE pets_allowed IS NULL;

-- ── Conditional checklist items ──────────────────────────────────────
ALTER TABLE public.association_intake_documents
  ADD COLUMN IF NOT EXISTS condition_key text;

DO $$ BEGIN
  ALTER TABLE public.association_intake_documents
    ADD CONSTRAINT chk_intake_condition
    CHECK (condition_key IS NULL OR condition_key IN ('vehicle','pet','assistance_animal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.association_intake_documents.condition_key IS
  'When set, this item only applies if the applicant declared the matching thing: vehicle = they keep a vehicle; pet = an ordinary pet at a pets-allowed association; assistance_animal = a service animal or ESA (any association).';

-- Existing vehicle items become conditional on the applicant keeping a vehicle.
UPDATE public.association_intake_documents
   SET condition_key = 'vehicle', updated_at = now()
 WHERE doc_key IN ('car_registration','vehicle_insurance')
   AND condition_key IS DISTINCT FROM 'vehicle';

UPDATE public.association_intake_documents
   SET condition_key = 'pet', updated_at = now()
 WHERE doc_key = 'pet_registration'
   AND condition_key IS DISTINCT FROM 'pet';

-- MANXI carried an ad-hoc 'pet_esa_documents' item on lease_renewal ONLY —
-- the assistance-animal question asked on exactly one of four application
-- types. It is superseded by 'assistance_animal_documentation' below, which
-- exists on every type of every association. No application had ever used it
-- (checked against application_documents, 2026-08-15), so it is retired rather
-- than migrated; deactivating leaves the row recoverable.
UPDATE public.association_intake_documents
   SET active = false, updated_at = now()
 WHERE doc_key = 'pet_esa_documents' AND active;

-- ── The applicant's own answers ──────────────────────────────────────
ALTER TABLE public.listing_applications
  ADD COLUMN IF NOT EXISTS declarations jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.listing_applications.declarations IS
  'Applicant-declared yes/no gates, e.g. {"vehicle":{"has":false,"at":"…"},"animal":{"has":true,"kind":"service","at":"…"}}. Drives which conditional checklist items apply; the derived N/A keys are still written to na_items so every existing completeness gate keeps working unchanged.';

-- ── The animal items, on EVERY association ───────────────────────────
-- User direction 2026-08-15: the pet registration + its signatures are the
-- default everywhere, not a Venetian Park I special case. Both rows are
-- OPTIONAL and conditional, so they stay invisible until an applicant says
-- they have an animal.
INSERT INTO public.association_intake_documents
  (association_code, application_type, doc_key, label, provided_by, required, note, sort_order, condition_key, created_by)
SELECT a.association_code, t.application_type, d.doc_key, d.label, 'applicant', false, d.note, d.sort_order, d.condition_key, 'maia_seed_20260815'
  FROM public.associations a
 CROSS JOIN (VALUES ('lease'),('purchase'),('lease_renewal'),('additional_occupant')) AS t(application_type)
 CROSS JOIN (VALUES
     ('pet_registration',
      'Pet Registration (e-signed)',
      'Completed and signed by the applicant — one entry per pet, with the rabies vaccination date.',
      900, 'pet'),
     ('assistance_animal_documentation',
      'Assistance Animal — supporting information',
      'For a service animal or an emotional support animal. Never a pet fee, pet deposit, or breed/size restriction; a service animal is never asked for medical documentation.',
      910, 'assistance_animal')
   ) AS d(doc_key, label, note, sort_order, condition_key)
ON CONFLICT (association_code, application_type, doc_key) DO UPDATE
  SET condition_key = EXCLUDED.condition_key,
      note          = EXCLUDED.note,
      required      = false,
      active        = true,
      updated_at    = now();

-- ── Manors XI can now be sent a Rules Knowledge Acknowledgment ───────
-- The e-signed acknowledgment files itself under 'governing_docs_ack'
-- (lib/esign.ts). MANXI had no such item, so the document had nowhere to
-- land. Its rules content is lib/manxi-rules-ack.ts and its Rules PDF is
-- stored at MANXI/rules-and-regulations-source-documents.pdf.
INSERT INTO public.association_intake_documents
  (association_code, application_type, doc_key, label, provided_by, required, note, sort_order, created_by)
SELECT 'MANXI', t.application_type, 'governing_docs_ack',
       'Rules Knowledge Acknowledgment (e-signed)', 'applicant', true,
       'Signed by every adult who will occupy the unit. Includes the Association''s recorded Rules and Regulations and the Manors Club master rules.',
       95, 'maia_seed_20260815'
  FROM (VALUES ('lease'),('purchase'),('lease_renewal'),('additional_occupant')) AS t(application_type)
ON CONFLICT (association_code, application_type, doc_key) DO UPDATE
  SET label = EXCLUDED.label, note = EXCLUDED.note, active = true, updated_at = now();

-- ── Manors XI's pet rule ─────────────────────────────────────────────
-- Entered by hand with a JSON *string* value ("true") rather than a boolean,
-- which every other rule row uses. Normalised, and the label sharpened so it
-- states what actually happens rather than reading as a blanket animal ban.
UPDATE public.association_application_rules
   SET value       = 'true'::jsonb,
       label       = 'No pets at any time. A service animal or emotional support animal is not a pet — it is a reasonable-accommodation request and is reviewed separately, with no pet fee, deposit, or breed/size restriction.',
       enforcement = 'warn',
       updated_at  = now()
 WHERE association_code = 'MANXI' AND rule_key = 'no_pet';

NOTIFY pgrst, 'reload schema';
