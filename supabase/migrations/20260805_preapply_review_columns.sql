-- =====================================================================
-- 20260805_preapply_review_columns.sql
--
-- Staff audit + approval fields for the Pre-Application intake (B4 slice 3):
--   audited_by / audited_at   — PMI + Jonathan signed off the documents
--   reviewed_by / reviewed_at / review_note — the approve/decline decision
--   approved_by_role          — 'onsite_manager' | 'board' | 'staff'
-- The intake advances submitted → under_review → approved | declined via
-- listing_applications.status (existing). ADD COLUMN IF NOT EXISTS is idempotent.
-- =====================================================================

ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS audited_by       text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS audited_at       timestamptz;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS reviewed_by      text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS review_note      text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS approved_by_role text;

NOTIFY pgrst, 'reload schema';
