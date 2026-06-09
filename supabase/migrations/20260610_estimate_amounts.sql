-- =====================================================================
-- 20260610_estimate_amounts.sql
-- Captured dollar amount + summary per submitted vendor estimate, so MAIA
-- can build a side-by-side comparison for Paola / the board. Filled by
-- Claude when the vendor uploads the estimate. Idempotent.
-- (Requires 20260609_estimate_requests.sql first.)
-- =====================================================================

ALTER TABLE public.estimate_request_vendors
  ADD COLUMN IF NOT EXISTS extracted_amount numeric,
  ADD COLUMN IF NOT EXISTS estimate_summary text;

NOTIFY pgrst, 'reload schema';
