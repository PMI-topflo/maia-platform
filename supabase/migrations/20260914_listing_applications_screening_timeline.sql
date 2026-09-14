-- =====================================================================
-- 20260914_listing_applications_screening_timeline.sql
--
-- Optional per-application background-check timeline shown on the
-- Processing audit card, for checks run OUTSIDE MAIA (Tenant Evaluation
-- has no API; its "Application progress" steps are copied from its
-- dashboard). Shape: {"provider":"Tenant Evaluation","steps":[{"label":
-- "...","at":"2026-07-27T09:40:00-04:00"}]}. Seeds MANXI 303 only, per the
-- user's screenshot (2026-09-14: "add only for this case"). Idempotent.
-- =====================================================================
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS screening_timeline jsonb;

UPDATE public.listing_applications SET screening_timeline = '{
  "provider": "Tenant Evaluation",
  "steps": [
    {"label": "Application form completed", "at": "2026-07-27T09:40:00-04:00"},
    {"label": "Applicants e-signatures",     "at": "2026-07-27T09:48:00-04:00"},
    {"label": "Services completed",          "at": "2026-07-27T09:55:00-04:00"},
    {"label": "Documents uploaded",          "at": "2026-07-28T09:24:00-04:00"}
  ]
}'::jsonb
 WHERE id = '4c17d02b-00a0-4569-9939-748e70cb1489' AND screening_timeline IS NULL;

NOTIFY pgrst, 'reload schema';
