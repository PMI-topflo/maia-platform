-- =====================================================================
-- 20260626_ledger_verified_phones.sql
--
-- "OTP once, then remember" for the owner ledger self-service flow. After an
-- owner passes a one-time code the first time they request a ledger, their
-- phone is recorded here so future requests skip straight to delivery (they
-- still confirm the unit address each time).
--
-- Reached only via the service-role admin client. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ledger_verified_phones (
  phone          text        PRIMARY KEY,
  account_number text,
  verified_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_verified_phones TO service_role;

ALTER TABLE public.ledger_verified_phones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_ledger_verified_phones" ON public.ledger_verified_phones;
CREATE POLICY "service_role_all_ledger_verified_phones"
  ON public.ledger_verified_phones FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
