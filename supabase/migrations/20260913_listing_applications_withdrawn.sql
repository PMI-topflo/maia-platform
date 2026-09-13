-- =====================================================================
-- 20260913_listing_applications_withdrawn.sql
-- Withdraw an application (status 'withdrawn') with who asked and why.
-- User request 2026-09-13 (MANXI 411: agent cancelled for the applicant).
-- Existing table: no GRANT block needed. Idempotent; registered in
-- lib/migration-status.ts.
-- =====================================================================
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS withdrawn_by text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS withdrawn_reason text;
NOTIFY pgrst, 'reload schema';
