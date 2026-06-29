-- =====================================================================
-- 20260628_application_stakeholders.sql
--
-- Foundation for the collaborative leasing/sale application process. Two-tier:
--   unit_listings          — one per unit being listed for rent/sale (the
--                            shared context: listing agent, owner, vacancy).
--   listing_applications   — one per applicant GROUP, linked to a listing
--                            (handles competing applicants on the same unit).
--   application_stakeholders — every person tagged to a listing OR an
--                            application (listing_agent, owner, applicant_agent,
--                            applicant) with contact info + a secure-link nonce.
--   application_documents  — uploads (listing agreement, lease / purchase
--                            agreement, applicant IDs) attached to a listing,
--                            an application, and/or a stakeholder.
--
-- Service-role only (accessed via lib/supabase-admin). Idempotent.
-- =====================================================================

-- ── unit_listings ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unit_listings (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code       text        NOT NULL,
  account_number         text,                        -- CINC PropertyHOID (the unit)
  unit_label             text,                        -- human-readable unit no
  listing_type           text        CHECK (listing_type IN ('rent', 'sale')),
  status                 text        NOT NULL DEFAULT 'open',  -- open | owner_review | closed | withdrawn
  unit_vacant            boolean,                     -- owner-validated
  prior_tenant_moved_out boolean,                     -- owner-validated (when a prior lease is on file)
  prior_lease_ref        text,                        -- reference to the existing lease/tenant if found
  owner_validated_at     timestamptz,
  created_by_role        text,                        -- listing_agent | applicant_agent | applicant | owner | staff
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS unit_listings_assoc_unit_idx
  ON public.unit_listings (association_code, account_number, created_at DESC);

-- ── listing_applications (one per applicant group) ───────────────────
-- NOTE: named listing_applications (not "applications") — a separate, rich
-- public.applications table already exists (ApplyCheck/board/payment pipeline).
-- This is the lightweight stakeholder-foundation tier; it can later link to a
-- detailed public.applications row via detailed_application_id.
CREATE TABLE IF NOT EXISTS public.listing_applications (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id              uuid        NOT NULL REFERENCES public.unit_listings(id) ON DELETE CASCADE,
  status                  text        NOT NULL DEFAULT 'started',  -- started | submitted | under_review | approved | declined | withdrawn
  detailed_application_id uuid,       -- loose link to public.applications (no FK; set when the detailed app is built)
  created_by_role         text,
  started_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_applications_listing_idx
  ON public.listing_applications (listing_id, created_at DESC);

-- ── application_stakeholders ─────────────────────────────────────────
-- Tagged to EITHER a listing (listing_agent, owner) OR an application
-- (applicant_agent, applicant). Exactly one of listing_id / application_id set.
CREATE TABLE IF NOT EXISTS public.application_stakeholders (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     uuid        REFERENCES public.unit_listings(id) ON DELETE CASCADE,
  application_id uuid        REFERENCES public.listing_applications(id)   ON DELETE CASCADE,
  role           text        NOT NULL CHECK (role IN ('listing_agent', 'owner', 'applicant_agent', 'applicant')),
  name           text,
  email          text,
  phone          text,
  is_primary     boolean     NOT NULL DEFAULT false,
  token_nonce    text        NOT NULL DEFAULT gen_random_uuid()::text,  -- for the secure access link
  status         text        NOT NULL DEFAULT 'invited',  -- invited | active | started | completed
  notified_at    timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,
  added_by_role  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stakeholder_attached_once CHECK (
    (listing_id IS NOT NULL)::int + (application_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX IF NOT EXISTS app_stakeholders_listing_idx     ON public.application_stakeholders (listing_id);
CREATE INDEX IF NOT EXISTS app_stakeholders_application_idx ON public.application_stakeholders (application_id);
CREATE INDEX IF NOT EXISTS app_stakeholders_email_idx       ON public.application_stakeholders (lower(email));

-- ── application_documents ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_documents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     uuid        REFERENCES public.unit_listings(id) ON DELETE CASCADE,
  application_id uuid        REFERENCES public.listing_applications(id)   ON DELETE CASCADE,
  stakeholder_id uuid        REFERENCES public.application_stakeholders(id) ON DELETE SET NULL,
  kind           text        NOT NULL CHECK (kind IN ('listing_agreement', 'lease', 'purchase_agreement', 'applicant_id', 'other')),
  storage_path   text        NOT NULL,
  filename       text        NOT NULL,
  mime_type      text,
  uploaded_by_role text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_documents_listing_idx     ON public.application_documents (listing_id);
CREATE INDEX IF NOT EXISTS app_documents_application_idx ON public.application_documents (application_id);

-- ── Private storage bucket for the uploads ───────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('application-docs', 'application-docs', false)
  ON CONFLICT (id) DO NOTHING;

-- ── Grants + RLS (service-role only; Supabase removes auto-grants 2026-10-30) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_listings            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_applications             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_stakeholders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_documents    TO service_role;

ALTER TABLE public.unit_listings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_applications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_stakeholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_documents    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_unit_listings"            ON public.unit_listings;
DROP POLICY IF EXISTS "service_role_all_listing_applications"     ON public.listing_applications;
DROP POLICY IF EXISTS "service_role_all_application_stakeholders" ON public.application_stakeholders;
DROP POLICY IF EXISTS "service_role_all_application_documents"    ON public.application_documents;

CREATE POLICY "service_role_all_unit_listings"            ON public.unit_listings            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_listing_applications"     ON public.listing_applications     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_application_stakeholders" ON public.application_stakeholders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_application_documents"    ON public.application_documents    FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
