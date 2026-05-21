-- =====================================================================
-- 20260521_email_logs_email_date.sql
--
-- email_logs.created_at is the LOG time (when MAIA recorded the row).
-- For backlog replays / re-ingests that is "now", not when the email
-- was actually sent — so the Communications view, which sorts by
-- created_at, shows re-ingested mail jumping to the top out of order.
--
-- This adds email_date: the message's TRUE date (Gmail internalDate
-- for inbound mail, send time for outbound). The Communications view
-- sorts and windows by email_date so it matches the real Gmail inbox.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS email_date timestamptz;

-- Backfill existing rows with created_at — a best-effort starting point.
-- Going forward logEmail stamps the real date; the /admin/tools
-- "Sync inbox" button corrects already-logged inbox mail to its true
-- Gmail internalDate.
UPDATE public.email_logs SET email_date = created_at WHERE email_date IS NULL;

ALTER TABLE public.email_logs
  ALTER COLUMN email_date SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS email_logs_email_date_idx
  ON public.email_logs (email_date DESC);
