-- =====================================================================
-- 20260610_utility_account_routes.sql
--
-- Account-number routing for utility / recurring invoices. Maps the
-- account number printed on a bill (FPL, water, Xfinity, etc.) to the
-- correct CINC vendor + association + GL — the account number is unique
-- to a service location, so it resolves the vendor/assoc/GL that fuzzy
-- name-matching gets wrong (e.g. Comcast vs Xfinity Business).
--
-- Populated two ways:
--   • seeded from CINC vendor/{id}/accounts (AccountNumber + AssocCode +
--     GlAccount) where CINC has it (FPL has all 20 assocs);
--   • learned from confirmed invoices on push (covers vendors CINC has
--     no account number for, e.g. Xfinity).
-- Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.utility_account_routes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number_norm  text        NOT NULL,   -- alnum-only, uppercased
  account_number_raw   text,
  cinc_vendor_id       text,
  vendor_name          text,
  association_code     text,
  gl_account_id        text,
  gl_account_name      text,
  source               text        NOT NULL DEFAULT 'confirmed',  -- 'cinc_seed' | 'confirmed'
  confirmed_at         timestamptz,
  confirmed_by         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS utility_account_routes_norm_uniq
  ON public.utility_account_routes (account_number_norm);

-- The account number extracted off the bill, kept on the draft so the
-- editor can show it + the push can write it back to CINC as VendorAccountNumber.
ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS extracted_account_number text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.utility_account_routes TO anon, authenticated, service_role;
ALTER TABLE public.utility_account_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_utility_account_routes" ON public.utility_account_routes;
CREATE POLICY "service_role_all_utility_account_routes"
  ON public.utility_account_routes FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
