-- =====================================================================
-- 20260805_associations_pet_limit.sql
--
-- Per-association pet limit for the Pet Registration e-sign form (the
-- applicant may register up to this many pets). Stored per-association
-- like the other thresholds rather than hard-coded; folds into the Board
-- Onboarding Questionnaire later. Defaults to 2 (the Manors form).
-- ADD COLUMN IF NOT EXISTS is instant + idempotent.
-- =====================================================================

ALTER TABLE public.associations ADD COLUMN IF NOT EXISTS pet_limit integer NOT NULL DEFAULT 2;

NOTIFY pgrst, 'reload schema';
