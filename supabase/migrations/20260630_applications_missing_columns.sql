-- =====================================================================
-- 20260630_applications_missing_columns.sql
--
-- Backfill 5 `applications` columns that were never applied to the live DB
-- (project etdxqzimmcvzvvtyvlkm) and were NOT registered in migration-status,
-- so they slipped through silently. The /apply submit (handlePay) writes
-- is_married_couple/occupants/rules_agreed_at/rules_signature on every insert,
-- and the board decision writes board_decision — so a missing column failed the
-- INSERT and broke submission + approval entirely. Idempotent.
-- =====================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS is_married_couple boolean,
  ADD COLUMN IF NOT EXISTS occupants         jsonb,
  ADD COLUMN IF NOT EXISTS rules_agreed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS rules_signature   text,
  ADD COLUMN IF NOT EXISTS board_decision    text DEFAULT 'pending';

NOTIFY pgrst, 'reload schema';
