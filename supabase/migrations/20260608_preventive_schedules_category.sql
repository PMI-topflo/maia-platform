-- =====================================================================
-- 20260608_preventive_schedules_category.sql
--
-- Adds `category` to preventive_schedules so the Maintenance calendar can
-- carry GOVERNANCE dates (budget preparation, annual election, annual
-- meeting, reserve-study due — from each condo's docs) alongside
-- preventive maintenance. category: 'maintenance' (default) | 'governance'.
--
-- Idempotent and self-sufficient: creates the table if the base migration
-- (20260608_preventive_schedules.sql) hasn't been applied yet, otherwise
-- just adds the column + constraint. Safe to re-run.
-- =====================================================================

-- Create-if-missing (full shape incl. category) so this works even when the
-- base table migration hasn't run.
CREATE TABLE IF NOT EXISTS public.preventive_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  task             text        NOT NULL,
  category         text        NOT NULL DEFAULT 'maintenance',
  cadence          text        NOT NULL,
  weekday          integer,
  day_of_month     integer,
  start_date       date        NOT NULL,
  vendor_name      text,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_prev_cadence CHECK (cadence IN ('weekly','monthly','quarterly','semiannual','annual'))
);

-- Add the column when the table already existed without it.
ALTER TABLE public.preventive_schedules
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'maintenance';

ALTER TABLE public.preventive_schedules DROP CONSTRAINT IF EXISTS chk_prev_category;
ALTER TABLE public.preventive_schedules
  ADD CONSTRAINT chk_prev_category CHECK (category IN ('maintenance','governance'));

-- Grants + RLS + index (idempotent) in case the table was created here.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventive_schedules
  TO anon, authenticated, service_role;
ALTER TABLE public.preventive_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_preventive_schedules" ON public.preventive_schedules;
CREATE POLICY "service_role_all_preventive_schedules"
  ON public.preventive_schedules FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS preventive_schedules_assoc_idx
  ON public.preventive_schedules (association_code) WHERE active;

NOTIFY pgrst, 'reload schema';
