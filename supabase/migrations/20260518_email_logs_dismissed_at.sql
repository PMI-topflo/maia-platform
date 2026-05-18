-- =====================================================================
-- email_logs — soft-dismiss (a.k.a. "clean up the screen")
--
-- Staff need a way to clear spam / non-actionable items off the
-- Communications view at end-of-day without losing the underlying
-- audit record. dismissed_at flags the row as "off the queue"; the
-- page filter hides those by default. A "Show dismissed" toggle
-- brings them back.
-- =====================================================================

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS dismissed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_by_email  text;

CREATE INDEX IF NOT EXISTS email_logs_active_idx
  ON public.email_logs (created_at DESC)
  WHERE dismissed_at IS NULL;

COMMENT ON COLUMN public.email_logs.dismissed_at IS
  'Set when staff dismisses a row from the Communications view (spam, not actionable, etc.). NULL = visible in the default queue. The row itself is preserved for audit.';
COMMENT ON COLUMN public.email_logs.dismissed_by_email IS
  'Email of the staff member who dismissed the row. Useful for the audit trail when staff dismiss collaboratively.';
