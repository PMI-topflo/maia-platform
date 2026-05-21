-- =====================================================================
-- 20260521_tickets_monthly_report_flag.sql
--
-- Adds tickets.marked_for_monthly_report — a staff-controlled flag that
-- selects which work orders appear in the monthly management report
-- (/admin/reports/monthly). Toggled from the work-order detail page.
--
-- METADATA-ONLY: adding a boolean column with a constant default is an
-- instant catalog change in Postgres 11+ (no table rewrite). The
-- partial index keeps the report query fast.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS marked_for_monthly_report boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS tickets_monthly_report_idx
  ON public.tickets (association_code, created_at DESC)
  WHERE marked_for_monthly_report = true;
