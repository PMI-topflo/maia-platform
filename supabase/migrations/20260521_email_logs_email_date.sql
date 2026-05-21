-- =====================================================================
-- 20260521_email_logs_email_date.sql
--
-- email_logs.created_at is the LOG time (when MAIA recorded the row).
-- For backlog replays / re-ingests / Sync back-fills that is "now",
-- not when the email was actually sent — so a list sorted by created_at
-- shows re-ingested mail jumping to the top out of order.
--
-- This adds email_date: the message's TRUE date (Gmail internalDate
-- for inbound mail, send time for outbound). The Communications view
-- sorts the displayed rows by email_date so it matches the real inbox.
--
-- METADATA-ONLY: adding a nullable column and setting a default are
-- catalog changes — instant on any table size, no row rewrite. There is
-- deliberately NO bulk UPDATE backfill here: email_logs has 146k rows
-- and a full-table UPDATE exceeds the statement timeout. Instead:
--   • new rows get email_date from logEmail (Gmail internalDate)
--   • existing rows stay NULL; the Communications view falls back to
--     created_at for them (email_date ?? created_at)
--   • the /admin/tools + Communications "Sync inbox" button stamps the
--     true date on every message currently in each Gmail inbox
--
-- Idempotent: safe to run more than once.
-- =====================================================================

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS email_date timestamptz;

ALTER TABLE public.email_logs
  ALTER COLUMN email_date SET DEFAULT NOW();
