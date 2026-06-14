-- Owner self-service compliance: per-unit occupancy status (owner-occupied /
-- leased / vacant). Drives which documents a unit is REQUIRED to have, and is
-- the first question owners answer in the self-service portal. Idempotent.
CREATE TABLE IF NOT EXISTS public.unit_occupancy (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  unit_ref         text        NOT NULL,           -- CINC account number
  status           text        NOT NULL,           -- owner_occupied | leased | vacant
  updated_by       text,                            -- 'owner' | staff email
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_unit_occupancy_status CHECK (status IN ('owner_occupied','leased','vacant'))
);
CREATE UNIQUE INDEX IF NOT EXISTS unit_occupancy_uniq ON public.unit_occupancy (association_code, unit_ref);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_occupancy TO anon, authenticated, service_role;
ALTER TABLE public.unit_occupancy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_unit_occupancy" ON public.unit_occupancy;
CREATE POLICY "service_role_all_unit_occupancy" ON public.unit_occupancy FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
