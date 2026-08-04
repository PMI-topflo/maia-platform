-- =====================================================================
-- 20260805_association_intake_documents.sql
--
-- Per-application-type document checklist for the Pre-Application Compliance
-- intake (B4). Unlike association_document_requirements (occupancy-scoped
-- unit compliance items), this is keyed by APPLICATION TYPE — Lease /
-- Purchase / Additional Occupant / Lease Renewal — and lists exactly which
-- documents each party (applicant / landlord / agent) must provide. Text
-- keys (no enum) so a new association or a new document is just another row,
-- never a migration. Mirrors the association_document_requirements pattern.
--
-- Seeded for Manors XI (MANXI) from the reconciled requirement slides.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.association_intake_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  application_type text        NOT NULL,   -- lease | purchase | additional_occupant | lease_renewal
  doc_key          text        NOT NULL,   -- e.g. 'signed_lease', 'drivers_license', 'car_registration'
  label            text        NOT NULL,
  provided_by      text        NOT NULL DEFAULT 'applicant',  -- applicant | landlord | agent
  required         boolean     NOT NULL DEFAULT true,
  note             text,                    -- optional clarifier (e.g. "owner HO policy, not renters")
  sort_order       integer     NOT NULL DEFAULT 0,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_intake_type     CHECK (application_type IN ('lease','purchase','additional_occupant','lease_renewal')),
  CONSTRAINT chk_intake_provider CHECK (provided_by IN ('applicant','landlord','agent'))
);
CREATE UNIQUE INDEX IF NOT EXISTS association_intake_documents_uniq
  ON public.association_intake_documents (association_code, application_type, doc_key);
CREATE INDEX IF NOT EXISTS association_intake_documents_lookup
  ON public.association_intake_documents (association_code, application_type, active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_intake_documents TO anon, authenticated, service_role;
ALTER TABLE public.association_intake_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_intake_documents" ON public.association_intake_documents;
CREATE POLICY "service_role_all_association_intake_documents" ON public.association_intake_documents FOR ALL TO service_role USING (true);
DROP POLICY IF EXISTS "public_read_association_intake_documents" ON public.association_intake_documents;
CREATE POLICY "public_read_association_intake_documents" ON public.association_intake_documents FOR SELECT TO anon, authenticated USING (active = true);

-- ── Seed MANXI (reconciled against the Manors XI requirement slides) ──
INSERT INTO public.association_intake_documents (association_code, application_type, doc_key, label, provided_by, required, note, sort_order, created_by) VALUES
  -- Lease / Renter
  ('MANXI','lease','signed_lease',        'Signed Lease Agreement',        'applicant', true,  NULL, 10, 'maia_seed'),
  ('MANXI','lease','drivers_license',     'Driver''s License / Photo ID',  'applicant', true,  NULL, 20, 'maia_seed'),
  ('MANXI','lease','car_registration',    'Vehicle Registration',          'applicant', true,  NULL, 30, 'maia_seed'),
  ('MANXI','lease','vehicle_insurance',   'Vehicle Insurance',             'applicant', true,  NULL, 40, 'maia_seed'),
  ('MANXI','lease','landlord_email',      'Landlord''s Email',             'applicant', true,  NULL, 50, 'maia_seed'),
  ('MANXI','lease','tax_returns_2yr',     'Last 2 Years'' Tax Returns',    'applicant', true,  'Tax return, not a W-2', 60, 'maia_seed'),
  ('MANXI','lease','property_insurance',  'Property Insurance',            'landlord',  true,  'Owner HO-6 policy, not renters', 70, 'maia_seed'),
  ('MANXI','lease','certificate_of_use',  'Certificate of Use',            'landlord',  true,  NULL, 80, 'maia_seed'),
  -- Purchase / Buyer
  ('MANXI','purchase','signed_purchase',  'Signed Purchase Agreement',     'applicant', true,  NULL, 10, 'maia_seed'),
  ('MANXI','purchase','drivers_license',  'Driver''s License / Photo ID',  'applicant', true,  NULL, 20, 'maia_seed'),
  ('MANXI','purchase','car_registration', 'Vehicle Registration',          'applicant', true,  NULL, 30, 'maia_seed'),
  ('MANXI','purchase','tax_returns_2yr',  'Last 2 Years'' Tax Returns',    'applicant', true,  'Tax return, not a W-2', 40, 'maia_seed'),
  -- Lease Renewal
  ('MANXI','lease_renewal','drivers_license',    'Driver''s License / Photo ID', 'applicant', true,  NULL, 10, 'maia_seed'),
  ('MANXI','lease_renewal','car_registration',   'Vehicle Registration',         'applicant', true,  NULL, 20, 'maia_seed'),
  ('MANXI','lease_renewal','vehicle_insurance',  'Vehicle Insurance',            'applicant', true,  NULL, 30, 'maia_seed'),
  ('MANXI','lease_renewal','homeowner_insurance','Homeowner Insurance',          'landlord',  true,  NULL, 40, 'maia_seed'),
  ('MANXI','lease_renewal','certificate_of_use', 'Certificate of Use (if expired)','landlord',false, NULL, 50, 'maia_seed'),
  -- Additional Occupant (age-driven at intake: 18+ screened; under-18 name+age only)
  ('MANXI','additional_occupant','drivers_license','Driver''s License / Photo ID (occupants 18+)','applicant', true, 'Under 18: name + age only, no documents', 10, 'maia_seed')
ON CONFLICT (association_code, application_type, doc_key)
  DO UPDATE SET label = EXCLUDED.label, provided_by = EXCLUDED.provided_by, required = EXCLUDED.required, note = EXCLUDED.note, sort_order = EXCLUDED.sort_order, updated_at = now();

NOTIFY pgrst, 'reload schema';
