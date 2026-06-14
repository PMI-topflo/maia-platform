-- Owner self-service: structured tenant contact for leased units (for mass
-- communication + leasing compliance). Captured by the owner in the portal
-- when they mark the unit Leased. Idempotent.
CREATE TABLE IF NOT EXISTS public.unit_tenant_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  unit_ref         text        NOT NULL,           -- CINC account number
  tenant_name      text,
  tenant_phone     text,
  tenant_email     text,
  lease_start      date,
  lease_end        date,
  updated_by       text,                            -- 'owner' | staff email
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_unit_tenant_one CHECK (true)
);
CREATE UNIQUE INDEX IF NOT EXISTS unit_tenant_contacts_uniq ON public.unit_tenant_contacts (association_code, unit_ref);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_tenant_contacts TO anon, authenticated, service_role;
ALTER TABLE public.unit_tenant_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_unit_tenant_contacts" ON public.unit_tenant_contacts;
CREATE POLICY "service_role_all_unit_tenant_contacts" ON public.unit_tenant_contacts FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
