-- =====================================================================
-- 20260522_monthly_reports_publish.sql
--
-- Publish state for a monthly report. Staff publish a saved report to
-- an audience (board / owners / both); it then appears on that
-- audience's portal (board members on /board, owners on /my-account)
-- and is viewable at /report/[id] for any matching logged-in user.
-- Publishing is reversible — clearing published_at un-publishes.
--
-- ALTER ... ADD COLUMN IF NOT EXISTS is instant; idempotent.
-- =====================================================================

ALTER TABLE public.monthly_reports
  ADD COLUMN IF NOT EXISTS published_at        timestamptz,
  ADD COLUMN IF NOT EXISTS published_audience  text,
  ADD COLUMN IF NOT EXISTS published_by_email  text;

ALTER TABLE public.monthly_reports
  DROP CONSTRAINT IF EXISTS monthly_reports_published_audience_chk;
ALTER TABLE public.monthly_reports
  ADD CONSTRAINT monthly_reports_published_audience_chk
  CHECK (published_audience IS NULL OR published_audience IN ('board', 'owners', 'both'));

CREATE INDEX IF NOT EXISTS monthly_reports_published_idx
  ON public.monthly_reports (association_code, published_at DESC)
  WHERE published_at IS NOT NULL;
