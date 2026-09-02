-- =====================================================================
-- 20260902_screening_expiry_warnings.sql
--
-- Dedupe table for the 45-day screening-validity warning cron
-- (app/api/cron/screening-expiry-warnings/route.ts, docs/ROADMAP.md's
-- "Screening validity" section). Warns the applicant at 10/5/1 days
-- before their screening's 45-day validity window closes, and once
-- more (days_before = 0) the moment it actually expires, with the
-- re-screening payment link. This table is what stops a daily cron
-- from re-sending a warning (or the expiry notice) already sent.
--
-- Keyed on the listing_applications row (not the individual
-- screening_subjects rows) since the validity clock is computed at the
-- application level in lib/board-review.ts -- it only starts once
-- EVERY subject on the application has completed.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.screening_expiry_warnings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_application_id uuid NOT NULL,
  days_before            int NOT NULL CHECK (days_before IN (10, 5, 1, 0)),  -- 0 = the expiry notice itself
  sent_at                timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screening_expiry_warnings_uniq UNIQUE (listing_application_id, days_before)
);

CREATE INDEX IF NOT EXISTS screening_expiry_warnings_app_idx
  ON public.screening_expiry_warnings (listing_application_id);

-- ── Data-API exposure (REQUIRED — see supabase/migrations/_TEMPLATE_new_table.sql) ──
-- Staff/cron-only table -- narrowed to service_role, no anon/authenticated.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.screening_expiry_warnings
  TO service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.screening_expiry_warnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_screening_expiry_warnings" ON public.screening_expiry_warnings;
CREATE POLICY "service_role_all_screening_expiry_warnings"
  ON public.screening_expiry_warnings FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
