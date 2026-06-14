-- Owner compliance audit: tracks the per-unit owner-document request emails so
-- the audit cron paces reminders (don't re-email within the cadence; cap the
-- number of reminders; stop once complete). Idempotent.
CREATE TABLE IF NOT EXISTS public.owner_compliance_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  unit_ref         text        NOT NULL,        -- CINC account number
  last_sent_at     timestamptz,
  send_count       int         NOT NULL DEFAULT 0,
  resolved_at      timestamptz,                 -- set when nothing is missing anymore
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS owner_compliance_requests_uniq ON public.owner_compliance_requests (association_code, unit_ref);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_compliance_requests TO anon, authenticated, service_role;
ALTER TABLE public.owner_compliance_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_owner_compliance_requests" ON public.owner_compliance_requests;
CREATE POLICY "service_role_all_owner_compliance_requests" ON public.owner_compliance_requests FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
