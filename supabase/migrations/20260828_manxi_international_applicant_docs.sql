-- =====================================================================
-- 20260828_manxi_international_applicant_docs.sql
--
-- User direction, 2026-08-28: wire the already-built international-
-- applicant package (foreign police clearance, CPA Financial
-- Certification, notarized translation — lib/intl-cpa-guide-pdf.tsx,
-- lib/intl-applicant-docs-content.ts) into MANXI's real Pre-Application
-- Compliance checklist. That package existed only in the older standalone
-- /apply self-serve form (components/ApplicationForm.tsx's "international"
-- appType) and was never reflected in the checklist/Application Guide that
-- actually drives MANXI purchase approvals.
--
-- New condition_key 'international' — mirrors the existing vehicle/pet/
-- assistance_animal pattern (lib/intake-documents.ts, lib/animal-
-- accommodation.ts): only applies once the applicant answers the new
-- purchase-only "Do you have 2 years of U.S. tax returns?" question with
-- "No". Purchase only — a lease/renewal/additional-occupant applicant is
-- never asked this.
--
-- Also: since there is no way to pull a U.S. credit score for an
-- international buyer, they pay one year of quarterly maintenance in
-- advance regardless of the credit-score bands the existing
-- credit_score_advance_maintenance rule uses — added as its own rule row
-- (not folded into that one) since it's a genuinely different condition,
-- not another credit-score band.
--
-- Idempotent.
-- =====================================================================

-- Widen the existing vehicle/pet/assistance_animal check constraint
-- (20260815_vehicle_animal_declarations.sql) to also allow 'international'.
ALTER TABLE public.association_intake_documents DROP CONSTRAINT IF EXISTS chk_intake_condition;
ALTER TABLE public.association_intake_documents
  ADD CONSTRAINT chk_intake_condition
  CHECK (condition_key IS NULL OR condition_key IN ('vehicle','pet','assistance_animal','international'));

COMMENT ON COLUMN public.association_intake_documents.condition_key IS
  'When set, this item only applies if the applicant declared the matching thing: vehicle = they keep a vehicle; pet = an ordinary pet at a pets-allowed association; assistance_animal = a service animal or ESA (any association); international = purchase applicant without 2 years of U.S. tax returns.';

INSERT INTO public.association_intake_documents
  (association_code, application_type, doc_key, label, provided_by, required, note, sort_order, condition_key, created_by)
VALUES
  ('MANXI', 'purchase', 'intl_police_clearance', 'Foreign Police Clearance Certificate / Criminal Record', 'applicant', true,
   'Required when the applicant does not have 2 years of U.S. tax returns.', 41, 'international', 'maia_seed_20260828'),
  ('MANXI', 'purchase', 'intl_cpa_certification', 'CPA Financial Certification', 'applicant', true,
   'Prepared by a CPA/CA licensed in the applicant''s country of residence — see the CPA requirements guide MAIA sends for exactly what it must contain.', 42, 'international', 'maia_seed_20260828'),
  ('MANXI', 'purchase', 'intl_translation', 'Notarized English Translation', 'applicant', false,
   'Only if the police clearance certificate or CPA certification above is issued in a foreign language.', 43, 'international', 'maia_seed_20260828')
ON CONFLICT (association_code, application_type, doc_key) DO UPDATE
  SET label = EXCLUDED.label, provided_by = EXCLUDED.provided_by, required = EXCLUDED.required,
      note = EXCLUDED.note, condition_key = EXCLUDED.condition_key, active = true, updated_at = now();

INSERT INTO public.association_application_rules
  (association_code, rule_key, value, label, enforcement, created_by)
VALUES
  ('MANXI', 'international_no_credit_advance_maintenance',
   '{"international": "1 year advance maintenance"}'::jsonb,
   'International applicants without 2 years of U.S. tax returns must pay one year of quarterly maintenance in advance — a U.S. credit score cannot be obtained to use the standard credit-score bands.',
   'warn', 'staff:pmi@topfloridaproperties.com')
ON CONFLICT (association_code, rule_key) DO UPDATE
  SET label = EXCLUDED.label, value = EXCLUDED.value, enforcement = EXCLUDED.enforcement, active = true, updated_at = now();

NOTIFY pgrst, 'reload schema';
