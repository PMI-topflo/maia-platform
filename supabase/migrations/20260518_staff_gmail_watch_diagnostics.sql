-- =====================================================================
-- staff_gmail_accounts — record the result of each watch-renewal
-- attempt so silent failures are visible.
--
-- Today the renew-gmail-watch cron logs errors to console.error and
-- moves on. Result: ar@ and ap@ have had expired watches for days
-- with no signal anywhere visible to staff.
--
-- After this migration, every cron pass writes one of:
--   - last_watch_renewed_at — on success
--   - last_watch_error / last_watch_error_at — on failure
--
-- The /admin/tools UI surfaces the error and offers a "Renew now"
-- button per account.
-- =====================================================================

ALTER TABLE public.staff_gmail_accounts
  ADD COLUMN IF NOT EXISTS last_watch_renewed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_watch_error       text,
  ADD COLUMN IF NOT EXISTS last_watch_error_at    timestamptz;

COMMENT ON COLUMN public.staff_gmail_accounts.last_watch_renewed_at IS
  'Timestamp of the last successful watch renewal. NULL until the first success after this migration runs.';
COMMENT ON COLUMN public.staff_gmail_accounts.last_watch_error IS
  'Error message from the most recent failed renewal attempt. NULL after a subsequent success. "invalid_grant" specifically means the OAuth refresh token was revoked and the account must be re-authorized.';
COMMENT ON COLUMN public.staff_gmail_accounts.last_watch_error_at IS
  'Timestamp of the last_watch_error. Combined with watch_expiry, lets the UI surface "needs reconnection" badges.';
