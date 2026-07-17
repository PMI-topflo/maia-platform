-- =====================================================================
-- 20260713_board_reminder_columns.sql
--
-- Adds member_type (decider/voter snapshot, taken at send-time so later
-- committee-config edits don't retroactively change in-flight
-- approvals) + reminder-cadence tracking columns to
-- application_board_reviews and estimate_approval_reviews.
-- Existing rows default to member_type='decider' so anything already
-- sent before this migration keeps counting toward its threshold
-- exactly as it did under the old symmetric (no decider/voter)
-- model — no retroactive behavior change for in-flight approvals.
-- Idempotent.
-- =====================================================================

ALTER TABLE public.application_board_reviews
  ADD COLUMN IF NOT EXISTS member_type text NOT NULL DEFAULT 'decider',
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.application_board_reviews
  DROP CONSTRAINT IF EXISTS chk_abr_member_type;
ALTER TABLE public.application_board_reviews
  ADD CONSTRAINT chk_abr_member_type CHECK (member_type IN ('decider','voter'));

ALTER TABLE public.estimate_approval_reviews
  ADD COLUMN IF NOT EXISTS member_type text NOT NULL DEFAULT 'decider',
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.estimate_approval_reviews
  DROP CONSTRAINT IF EXISTS chk_eapr_member_type;
ALTER TABLE public.estimate_approval_reviews
  ADD CONSTRAINT chk_eapr_member_type CHECK (member_type IN ('decider','voter'));

NOTIFY pgrst, 'reload schema';
