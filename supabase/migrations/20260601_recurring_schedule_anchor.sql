-- =====================================================================
-- 20260601_recurring_schedule_anchor.sql
-- Make recurring-service scheduling cadence-accurate so weekly-coverage
-- flags only fire on weeks a service is actually due.
--
--   schedule_anchor  — for BIWEEKLY: a reference Monday that establishes
--                      which alternating weeks are "on". A week is due
--                      when an even number of weeks separate it from the
--                      anchor. Null → falls back to every week.
--   monthly_day      — for MONTHLY: day-of-month (1–31, clamped to the
--                      month length). The visit is due in the ISO week
--                      (Mon–Sun) that contains that calendar day. Null →
--                      the week containing the 1st.
--
-- Weekly services ignore both. Idempotent.
-- =====================================================================

alter table public.recurring_services
  add column if not exists schedule_anchor date,
  add column if not exists monthly_day     smallint check (monthly_day between 1 and 31);

NOTIFY pgrst, 'reload schema';
