-- =====================================================================
-- 20260914_listing_applications_auto_expiry.sql
--
-- Automatic expiry of dead applications (user direction, 2026-09-14,
-- replacing manual housekeeping): a daily cron warns the people on the
-- application, then expires it when the notice runs out —
--   no_files            opened, no document after 7 days → 7-day notice
--   unpaid              screening fee unpaid 7 days after request → 48-hour notice
--   stale               waiting on the applicant, idle 21 days → 7-day notice
--   screening_expired   45-day screening validity passed → expires 7 days later
-- expiry_notice_kind/at/due_at track the open notice (cleared when the
-- person acts). closed_drive records the files moved to the Archive on
-- withdraw/expire so Reopen can pull them back. expired_auto marks closes
-- done by the cron (the daily staff email lists them). Idempotent.
-- =====================================================================
ALTER TABLE public.listing_applications
  ADD COLUMN IF NOT EXISTS expiry_notice_kind text,
  ADD COLUMN IF NOT EXISTS expiry_notice_at timestamptz,
  ADD COLUMN IF NOT EXISTS expiry_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closed_drive jsonb;

NOTIFY pgrst, 'reload schema';
