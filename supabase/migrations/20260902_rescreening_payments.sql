-- =====================================================================
-- 20260902_rescreening_payments.sql
--
-- The $150 re-screening charge (docs/ROADMAP.md's "Re-screening charge"
-- section): when an application's Checkr screening expires (45 days,
-- lib/screening/validity.ts) before every document is submitted, the
-- applicant is emailed a one-time payment link to app/rescreen/[token]
-- to buy a fresh screening. Deliberately its own small table, not a
-- reuse of the applications/listing_applications payment fields --
-- this is a distinct charge from the original application fee, with
-- its own Stripe Price ID (STRIPE_PRICE_RESCREENING) and its own
-- "this is not an application fee" legal framing, per the user's
-- exact wording, everywhere it appears.
--
-- token is the public.rescreen/[token] page's entire auth -- same
-- pattern as lease_renewal_checks.owner_token/tenant_token, not an
-- HMAC (this is a single one-time action, not a long-lived session).
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.rescreening_payments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_application_id uuid NOT NULL,
  token                  text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  stripe_session_id      text,
  paid_at                timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rescreening_payments_token_uniq UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS rescreening_payments_app_idx
  ON public.rescreening_payments (listing_application_id);

-- ── Data-API exposure (REQUIRED — see supabase/migrations/_TEMPLATE_new_table.sql) ──
-- The public rescreen page reads/writes its own row by token via the admin
-- client server-side only (no browser Supabase access to this table) --
-- narrowed to service_role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rescreening_payments
  TO service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.rescreening_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_rescreening_payments" ON public.rescreening_payments;
CREATE POLICY "service_role_all_rescreening_payments"
  ON public.rescreening_payments FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
