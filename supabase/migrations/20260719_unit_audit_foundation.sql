-- =====================================================================
-- 20260719_unit_audit_foundation.sql
--
-- Foundation for the association unit-audit portal (board + local
-- managers + staff). Three things:
--
-- 1. Ensures unit_managers / building_managers EXIST. The original
--    migration (20260505_unit_building_managers.sql) was never applied
--    to prod (the manager portals + add-person + OTP login all reference
--    these tables but they were missing from the live schema, so managers
--    couldn't log in). Idempotent CREATE re-asserts them, and — unlike the
--    original — adds the GRANTs Supabase requires (auto-grants removed
--    2026-10-30) plus explicit service_role policies.
-- 2. Adds `can_upload` to both manager tables — staff can revoke a
--    manager's ability to submit documents ("give permission to their
--    managers to upload").
-- 3. Creates unit_document_submissions — the manager-upload → staff/board
--    approval queue. MAIA validates each upload (type + expiry via
--    lib/document-validation) and stores the read; a submission stays
--    'pending' until staff/board approve it into compliance_records.
--
-- Idempotent.
-- =====================================================================

-- ── Manager tables (re-assert; original 20260505 never applied) ──────
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
CREATE INDEX IF NOT EXISTS unit_managers_assoc_idx ON public.unit_managers (association_code);
CREATE INDEX IF NOT EXISTS unit_managers_email_idx ON public.unit_managers (lower(email));
CREATE INDEX IF NOT EXISTS unit_managers_phone_idx ON public.unit_managers (phone);

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
CREATE INDEX IF NOT EXISTS building_managers_assoc_idx ON public.building_managers (association_code);
CREATE INDEX IF NOT EXISTS building_managers_email_idx ON public.building_managers (lower(email));
CREATE INDEX IF NOT EXISTS building_managers_phone_idx ON public.building_managers (phone);

-- ── can_upload flag (default true = may submit into the approval queue) ─
ALTER TABLE public.unit_managers      ADD COLUMN IF NOT EXISTS can_upload boolean NOT NULL DEFAULT true;
ALTER TABLE public.building_managers  ADD COLUMN IF NOT EXISTS can_upload boolean NOT NULL DEFAULT true;

-- ── Manager-upload → approval queue ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unit_document_submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code    text NOT NULL,
  unit_ref            text NOT NULL,          -- account_number (the canonical unit key)
  item_key            text NOT NULL,          -- compliance-taxonomy key (e.g. unit.ho6)
  scope               text NOT NULL DEFAULT 'unit',   -- 'unit' | 'tenant'
  storage_key         text NOT NULL,          -- Supabase storage path of the uploaded file
  filename            text,
  submitted_by_persona text NOT NULL,         -- board | building_manager | unit_manager | staff
  submitted_by_id     text,                   -- persona-record id (uuid/text)
  submitted_by_name   text,
  submitted_by_email  text,
  ai_verdict          text,                   -- approved | wrong_type | unreadable | expired
  ai_identified_as    text,
  ai_expiration_date  date,
  ai_summary          text,
  status              text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_by         text,
  reviewed_at         timestamptz,
  review_note         text,
  compliance_record_id uuid,                  -- set when approved → filed into compliance_records
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.unit_document_submissions
  DROP CONSTRAINT IF EXISTS chk_uds_status;
ALTER TABLE public.unit_document_submissions
  ADD CONSTRAINT chk_uds_status CHECK (status IN ('pending','approved','rejected'));

CREATE INDEX IF NOT EXISTS uds_assoc_status_idx ON public.unit_document_submissions (association_code, status);
CREATE INDEX IF NOT EXISTS uds_unit_idx         ON public.unit_document_submissions (association_code, unit_ref);

-- ── Grants + RLS ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_managers            TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.building_managers        TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_document_submissions TO anon, authenticated, service_role;

ALTER TABLE public.unit_managers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_managers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_document_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_unit_managers"             ON public.unit_managers;
DROP POLICY IF EXISTS "service_role_all_building_managers"         ON public.building_managers;
DROP POLICY IF EXISTS "service_role_all_unit_document_submissions" ON public.unit_document_submissions;
CREATE POLICY "service_role_all_unit_managers"             ON public.unit_managers             FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_building_managers"         ON public.building_managers         FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_unit_document_submissions" ON public.unit_document_submissions FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
