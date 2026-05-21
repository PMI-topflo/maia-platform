-- =====================================================================
-- 20260521_tickets_report_exclusion.sql
--
-- Monthly-report curation flipped from opt-in to opt-out. The report now
-- covers every ticket / work order for the month by default; staff
-- untick the ones to leave out, in the report preview. This replaces the
-- opt-in `marked_for_monthly_report` flag with an exclusion flag.
--
-- METADATA-ONLY: DROP COLUMN and ADD COLUMN with a constant default are
-- both instant catalog changes (no row rewrite). Idempotent. Dropping
-- the old column also drops its partial index automatically.
-- =====================================================================

ALTER TABLE public.tickets
  DROP COLUMN IF EXISTS marked_for_monthly_report;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS excluded_from_monthly_report boolean NOT NULL DEFAULT false;
