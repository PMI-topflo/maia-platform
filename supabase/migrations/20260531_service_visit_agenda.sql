-- =====================================================================
-- 20260531_service_visit_agenda.sql
-- Phase 3a: the vendor office confirms next week's agenda — which crew
-- and which day(s). Store the planned date + assigned crew on the visit.
-- Idempotent.
-- =====================================================================

alter table public.service_visits
  add column if not exists planned_date         date,
  add column if not exists assigned_employee_ids uuid[] not null default '{}',
  add column if not exists confirmed_at          timestamptz;

NOTIFY pgrst, 'reload schema';
