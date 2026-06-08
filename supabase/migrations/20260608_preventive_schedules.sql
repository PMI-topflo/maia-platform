-- =====================================================================
-- 20260608_preventive_schedules.sql
--
-- Preventive maintenance schedules per association — the data behind the
-- Association Hub's Maintenance tab + calendar. Each row is a recurring
-- task (pool service, elevator inspection, fire alarm test…) with a
-- cadence; the calendar computes occurrences from these (no rows are
-- pre-generated). Soft delete = active=false.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.preventive_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  task             text        NOT NULL,
  cadence          text        NOT NULL,
  weekday          integer,                 -- 0..6 (Sun..Sat) for weekly
  day_of_month     integer,                 -- 1..28 for monthly+
  start_date       date        NOT NULL,    -- anchor; first occurrence on/after
  vendor_name      text,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_prev_cadence CHECK (cadence IN ('weekly','monthly','quarterly','semiannual','annual'))
);

CREATE INDEX IF NOT EXISTS preventive_schedules_assoc_idx
  ON public.preventive_schedules (association_code) WHERE active;

-- Data-API exposure (required for new tables per 2026-10-30 change).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventive_schedules
  TO anon, authenticated, service_role;

ALTER TABLE public.preventive_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_preventive_schedules" ON public.preventive_schedules;
CREATE POLICY "service_role_all_preventive_schedules"
  ON public.preventive_schedules FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
