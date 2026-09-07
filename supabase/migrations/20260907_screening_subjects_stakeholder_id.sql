-- =====================================================================
-- 20260907_screening_subjects_stakeholder_id.sql
--
-- User report, 2026-09-07: filing a completed Checkr report onto its
-- applicant's own "Background / Credit Reports" checklist row was
-- guessing which applicant it belonged to by comparing Checkr's own
-- subject.name against application_stakeholders.name -- a mismatch
-- (case, punctuation, spacing, a nickname) silently left the report
-- unscoped and invisible on every applicant's row. Adds a real column
-- set once, at order-creation time (app/api/trigger-screening/route.ts),
-- from the applicant MAIA already knows it's placing the order for --
-- no guessing needed from then on.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.screening_subjects
  ADD COLUMN IF NOT EXISTS stakeholder_id uuid REFERENCES public.application_stakeholders(id);

NOTIFY pgrst, 'reload schema';
