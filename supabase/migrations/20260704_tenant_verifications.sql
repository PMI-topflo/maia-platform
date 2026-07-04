-- Pre-registration triage Phase 2: tenant self-identification verification.
-- A self-identified tenant needs a lease + board-approval-letter on file,
-- plus either owner confirmation or staff-sourced documents, before they can
-- be inserted into association_tenants. Idempotent.

CREATE TABLE IF NOT EXISTS public.tenant_verifications (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_registration_id     uuid REFERENCES public.pre_registrations(id),
  association_code        text,
  association_name        text,
  unit_number              text,
  tenant_name              text,
  email                    text,
  phone                    text,
  lease_path               text,
  lease_source             text CHECK (lease_source IN ('tenant', 'owner', 'staff')),
  lease_uploaded_at        timestamptz,
  board_letter_path        text,
  board_letter_source      text CHECK (board_letter_source IN ('tenant', 'owner', 'staff')),
  board_letter_uploaded_at timestamptz,
  owner_account_number     text,
  owner_confirmed          boolean NOT NULL DEFAULT false,
  owner_confirmed_at       timestamptz,
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_owner', 'ready', 'approved', 'rejected')),
  lease_start_date         date,
  notes                    text,
  created_by               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_verifications_prereg_uniq
  ON public.tenant_verifications (pre_registration_id) WHERE pre_registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tenant_verifications_unit_idx
  ON public.tenant_verifications (association_code, unit_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_verifications
  TO anon, authenticated, service_role;

ALTER TABLE public.tenant_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_tenant_verifications" ON public.tenant_verifications;
CREATE POLICY "service_role_all_tenant_verifications" ON public.tenant_verifications FOR ALL TO service_role USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-verification-docs', 'tenant-verification-docs', false)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
