-- =====================================================================
-- 20260626_recurring_service_end_date.sql
--
-- Let staff schedule a recurring service to END on a specific date, and
-- track that MAIA has emailed the office once the cycle closes.
--
--   ends_on                 — last calendar date the service runs (any
--                             day/month/year). Null = open-ended. Visit
--                             generation skips weeks that start after it.
--   cycle_ended_notified_at — set when the "cycle ended" email is sent to
--                             the office, so it fires exactly once; the
--                             service is also deactivated at that point.
--
-- recurring_services is an existing table — legacy grants apply. Idempotent.
-- =====================================================================

alter table public.recurring_services
  add column if not exists ends_on                 date,
  add column if not exists cycle_ended_notified_at timestamptz;

NOTIFY pgrst, 'reload schema';
