-- Lease Renewal Check-In: real bug, 2026-08-26 — the "Lease expiring in N
-- days" cron (app/api/cron/lease-renewal-alerts/route.ts) told the owner and
-- tenant a lease was ending with no way to actually act on it — just a
-- mailto link. This table backs the token-gated check-in page
-- (app/lease-renewal/[token]/page.tsx) both reminder windows now link to:
-- the tenant reports renew/vacate/vacated/already-signed/needs-to-apply, the
-- owner reports occupancy + renew/already-signed. One row per
-- (association, unit, lease end) so the SAME link is reused across the
-- 30-day and 7-day reminder rather than minting a new token each time.
-- Idempotent.
CREATE TABLE IF NOT EXISTS public.lease_renewal_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code    text        NOT NULL,
  unit_label          text        NOT NULL,
  lease_end           date        NOT NULL,
  owner_token         uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_token        uuid        NOT NULL DEFAULT gen_random_uuid(),
  owner_email         text,
  tenant_email        text,
  owner_name          text,
  tenant_name         text,
  owner_occupancy     text,                     -- owner_occupied | leased | vacant
  owner_response      text,                     -- renew | signed
  owner_responded_at  timestamptz,
  tenant_response     text,                     -- renew | vacating | vacated | signed | apply
  tenant_responded_at timestamptz,
  application_id      uuid        REFERENCES public.listing_applications(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_lrc_owner_occupancy CHECK (owner_occupancy IS NULL OR owner_occupancy IN ('owner_occupied','leased','vacant')),
  CONSTRAINT chk_lrc_owner_response  CHECK (owner_response  IS NULL OR owner_response  IN ('renew','signed')),
  CONSTRAINT chk_lrc_tenant_response CHECK (tenant_response IS NULL OR tenant_response IN ('renew','vacating','vacated','signed','apply'))
);
CREATE UNIQUE INDEX IF NOT EXISTS lease_renewal_checks_uniq ON public.lease_renewal_checks (association_code, unit_label, lease_end);
CREATE UNIQUE INDEX IF NOT EXISTS lease_renewal_checks_owner_token ON public.lease_renewal_checks (owner_token);
CREATE UNIQUE INDEX IF NOT EXISTS lease_renewal_checks_tenant_token ON public.lease_renewal_checks (tenant_token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lease_renewal_checks TO anon, authenticated, service_role;
ALTER TABLE public.lease_renewal_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_lease_renewal_checks" ON public.lease_renewal_checks;
CREATE POLICY "service_role_all_lease_renewal_checks" ON public.lease_renewal_checks FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
