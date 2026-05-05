-- =====================================================================
-- Unit Managers: people who manage specific units (not PMI staff)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.unit_managers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       text        NOT NULL,
  last_name        text        NOT NULL,
  email            text,
  phone            text,
  association_code text        NOT NULL,
  managed_units    text[]      NOT NULL DEFAULT '{}',
  company_name     text,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.unit_managers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS unit_managers_assoc_idx  ON public.unit_managers (association_code);
CREATE INDEX IF NOT EXISTS unit_managers_email_idx  ON public.unit_managers (lower(email));
CREATE INDEX IF NOT EXISTS unit_managers_phone_idx  ON public.unit_managers (phone);

-- =====================================================================
-- Building Managers: on-site managers, view-only access like board members
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.building_managers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       text        NOT NULL,
  last_name        text        NOT NULL,
  email            text,
  phone            text,
  association_code text        NOT NULL,
  company_name     text,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.building_managers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS building_managers_assoc_idx ON public.building_managers (association_code);
CREATE INDEX IF NOT EXISTS building_managers_email_idx ON public.building_managers (lower(email));
CREATE INDEX IF NOT EXISTS building_managers_phone_idx ON public.building_managers (phone);
