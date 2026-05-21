-- =====================================================================
-- 20260521_monthly_reports.sql
--
-- Stores each generated monthly management report so it has a stable,
-- shareable URL (/admin/reports/monthly/view/[id]) instead of only
-- living in the browser after a one-off generate.
--
-- One report per (association, month). association_code = 'ALL' is the
-- all-associations report. Re-generating upserts on that pair.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.monthly_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code    text        NOT NULL DEFAULT 'ALL',
  month               text        NOT NULL,                 -- 'YYYY-MM'
  report_markdown     text        NOT NULL,
  generated_by_email  text,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (association_code, month)
);

CREATE INDEX IF NOT EXISTS monthly_reports_assoc_idx
  ON public.monthly_reports (association_code, month DESC);

ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_monthly_reports"
  ON public.monthly_reports FOR ALL TO service_role USING (true);
