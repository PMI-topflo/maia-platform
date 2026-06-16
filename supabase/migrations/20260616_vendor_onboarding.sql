-- =====================================================================
-- 20260616_vendor_onboarding.sql
--
-- Tracks the onboarding of a brand-new vendor that staff (Paola) just
-- created in CINC. Holds the new cinc_vendor_id, the vendor basics, and
-- per-doc collection status (COI / license / W-9 / ACH) as the vendor
-- submits them through the standalone onboarding portal. License is only
-- required for licensed trades. ACH lands as "received" and a staffer
-- confirms it before it's written to CINC (fraud control).
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.vendor_onboarding (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cinc_vendor_id   bigint,                      -- set on create (CINC POST returns it)
  company_name     text NOT NULL,
  email            text,
  phone            text,
  address1         text,
  city             text,
  state            text,
  zip              text,
  vendor_type_id   text,                        -- CINC VendorTypeID
  vendor_type_name text,
  license_required boolean NOT NULL DEFAULT false,
  coi_status       text NOT NULL DEFAULT 'pending',   -- pending|received|applied|na
  license_status   text NOT NULL DEFAULT 'na',        -- pending|received|applied|na
  w9_status        text NOT NULL DEFAULT 'pending',
  ach_status       text NOT NULL DEFAULT 'pending',
  docs             jsonb NOT NULL DEFAULT '{}'::jsonb, -- per-doc storage paths + masked fields
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_vonb_coi CHECK (coi_status     IN ('pending','received','applied','na')),
  CONSTRAINT chk_vonb_lic CHECK (license_status IN ('pending','received','applied','na')),
  CONSTRAINT chk_vonb_w9  CHECK (w9_status      IN ('pending','received','applied','na')),
  CONSTRAINT chk_vonb_ach CHECK (ach_status     IN ('pending','received','applied','na'))
);

CREATE INDEX IF NOT EXISTS vendor_onboarding_cinc_vendor_idx ON public.vendor_onboarding (cinc_vendor_id);
CREATE INDEX IF NOT EXISTS vendor_onboarding_created_idx ON public.vendor_onboarding (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_onboarding
  TO anon, authenticated, service_role;

ALTER TABLE public.vendor_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_vendor_onboarding" ON public.vendor_onboarding;
CREATE POLICY "service_role_all_vendor_onboarding"
  ON public.vendor_onboarding FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
