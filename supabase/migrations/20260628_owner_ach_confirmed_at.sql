-- =====================================================================
-- 20260628_owner_ach_confirmed_at.sql
--
-- Adds confirmed_at to owner_ach_submissions. Set when staff click the
-- "Confirm autopay set up" button in the enrollment email, which also emails
-- the unit owner the automatic confirmation. Idempotent.
-- =====================================================================

ALTER TABLE public.owner_ach_submissions
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

NOTIFY pgrst, 'reload schema';
