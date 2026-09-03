-- =====================================================================
-- 20260903c_outbound_send_error.sql
--
-- User direction, 2026-09-03: "can we receive an email each time it fails?"
-- sendEmail() previously let a provider error (Resend rejecting the
-- request, Gmail OAuth failing) propagate with no record of WHY — most
-- callers do `.catch(() => null)` for their own control flow, so the
-- failure vanished with no trace. Adds a nullable `error` column,
-- parallel to the existing `blocked_reason`, so a failed send is
-- recorded the same way a blocked one already is.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.outbound_send_attempts ADD COLUMN IF NOT EXISTS error text;

NOTIFY pgrst, 'reload schema';
