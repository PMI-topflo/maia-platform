-- =====================================================================
-- 20260913_application_payment_reconciliation.sql
--
-- Application payments reconciliation (Accounting → Application payments).
-- Stripe is read live (charges, fees, payouts); Checkr receipts are
-- uploaded from the Checkr dashboard's receipt download. These two tables
-- hold what MAIA cannot read from an API:
--   stripe_payout_receipts — Karen's "received in bank" flag per Stripe
--                            payout (a payout is exactly one bank deposit).
--   checkr_receipts        — one row per Checkr order receipt, matched to
--                            screening_subjects.checkr_order_id.
-- User request 2026-09-13. Idempotent; registered in lib/migration-status.ts.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.stripe_payout_receipts (
  payout_id         text PRIMARY KEY,
  amount_cents      integer,
  arrival_date      date,
  bank_received_at  timestamptz,
  bank_received_by  text,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_payout_receipts TO anon, authenticated, service_role;
ALTER TABLE public.stripe_payout_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_stripe_payout_receipts" ON public.stripe_payout_receipts;
CREATE POLICY "service_role_all_stripe_payout_receipts" ON public.stripe_payout_receipts FOR ALL TO service_role USING (true);

CREATE TABLE IF NOT EXISTS public.checkr_receipts (
  order_id          text PRIMARY KEY,
  amount_cents      integer NOT NULL,
  paid_on           date,
  applicant_name    text,
  applicant_email   text,
  property          text,
  package           text,
  filename          text,
  uploaded_by       text,
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkr_receipts TO anon, authenticated, service_role;
ALTER TABLE public.checkr_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_checkr_receipts" ON public.checkr_receipts;
CREATE POLICY "service_role_all_checkr_receipts" ON public.checkr_receipts FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
