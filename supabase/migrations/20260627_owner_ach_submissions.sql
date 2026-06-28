-- =====================================================================
-- 20260627_owner_ach_submissions.sql
--
-- Audit trail for owner-submitted ACH/autopay enrollments. The full routing
-- and account numbers are written to CINC only and NEVER stored here — we keep
-- the signed authorization + last-4 + outcome for the record.
-- Staff-only (service-role). Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.owner_ach_submissions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code   text        NOT NULL,
  account_number     text        NOT NULL,
  property_id        integer,
  owner_name         text,
  bank_name          text,
  account_owner_name text,
  account_type       text,                       -- 'checking' | 'savings'
  routing_last4      text,
  account_last4      text,
  signature          text,                       -- typed authorization signature
  authorized         boolean     NOT NULL DEFAULT false,
  signed_ip          text,
  signed_user_agent  text,
  cinc_written       boolean     NOT NULL DEFAULT false,
  cinc_response      jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_ach_submissions_acct_idx
  ON public.owner_ach_submissions (association_code, account_number, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_ach_submissions TO service_role;

ALTER TABLE public.owner_ach_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_owner_ach_submissions" ON public.owner_ach_submissions;
CREATE POLICY "service_role_all_owner_ach_submissions"
  ON public.owner_ach_submissions FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
